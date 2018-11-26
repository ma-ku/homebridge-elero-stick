'use strict';

const SerialPort = require('serialport');
const EventEmitter = require('events').EventEmitter;
const EleroParser = require('./parser');

const ELERO_COMMANDS = {
    UP:         0x20,
    INTERM_POS: 0x44,
    VENT_POS:   0x24,
    DOWN:       0x40,
    STOP:       0x10  
};

const ELERO_STATES = {
    NO_INTORMATION:         0x00,
    TOP_POS_STOP:           0x01,
    BOTTOM_POS_STOP:        0x02,
    INTERM_POS_STOP:        0x03,
    TILT_POS_STOP:          0x04,
    BLOCKING:               0x05,
    OVERHEATED:             0x06,
    TIMEOUT:                0x07,
    START_MOVE_UP:          0x08,
    START_MOVE_DOWN:        0x09,
    MOVING_UP:              0x0A,
    MOVING_DOWN:            0x0B,
    STOP_UNDEFINED_POS:     0x0D,
    TOP_VENT_POS_STOP:      0x0E,
    BOTTOM_INTERM_POS_STOP: 0x0F,
    SWITCHING_DEVICE_OFF:   0x10,
    SWITCHING_DEVICE_ON:    0x11
};

let EleroStickConnectionInstances = {};

/**
 * This class handles the connection to the underlying Elero Stick. Since
 * this is a single stick for multiple accessories, it is implemented as a 
 * singleton
 */
class EleroStickConnection extends EventEmitter {

    constructor(log, port) {
        super();

        this.log = log;
        this.port = port;

        this.serial;
        this.connectionBusy = false;
        this.commandQueue = [];

        this.connect();
    }

    /**
     * @param {Log} log
     * @param {string} port
     * @returns {EleroStickConnection}
     */
    static getInstance(log, port) {
        let instanceKey = port;

        if (!EleroStickConnectionInstances[instanceKey]) {
            let instance = new EleroStickConnection(log, port);
            EleroStickConnectionInstances[instanceKey] = instance;
        }

        return EleroStickConnectionInstances[instanceKey];
    }

    connect() {
        // Settings are static for the Elero stick
        this.serial = new SerialPort(this.port, {
                            baudRate: 38400
                        });
          
        // We put a parser into place to check for valid
        // Elero responses and that emits only full response packages
        this.parser = this.serial.pipe(new EleroParser())

        this.parser.on('data', (data) => {
                            this.incomingData(data);
                        })
                    
                    .on('connect', () => {
                        })
                        
                    .on('close', () => {
                            this.connect();
                        });
    }

    checksum(data) {

        var sum = 0;
        data.forEach(element => {
          sum += element;
        });
      
        return sum & 0xff;
    }

    sendCommand(command) {
        if (this.connectionBusy) {
            this.commandQueue.push(command);
        } 
        else {
            this.connectionBusy = true;
            this.send(command);
        }
    }

    send(data) {

        var msg = new Uint8Array(data.length + 1);
        msg.set(data);

        // Compute checksum byte for the message
        var checksum = this.checksum(msg);
        var csByte = 0x100 - (checksum & 0xff);
        msg[data.length] = csByte

        this.log("Sending Raw Message: ", msg);
        
        this.serial.write(msg, function(err) {
          if (err) {
            return this.log('Error on write: ', err.message);
          }
        });
    }

    incomingData(data) {

        this.log("Received data ", data);

        if (this.checksum(data) == 0) {
            
            var valid = false;

            do {
                // Header
                if (data[0] != 0xAA) break;
                
                if ((data[1] == 0x05) && (data[2] == 0x4D)) {
                    // Easy_Ack
                    var channels = this.decodeChannels(data[3], data[4]);
                    const info = getKeyByValue(ELERO_STATES, data[5]);

                    channels.forEach( function(channel) {
                        statusReceived(info, channel);
                    });
                }
                else if ((data[1] == 0x04) && (data[2] == 0x4B)) {
                    // Easy_Confirm
                    this.channels = this.decodeChannels(data[3], data[4]);
                    this.emit('connect', this.channels);
                }
                else break;

            } while (false);

            return
        }
        else {
            this.log("Invalid checksum ", this.checksum(data));
        }

        this.log("Could not decode response", data);
        // this.error("Received invalid response: ", data)
    }

    /**
     * 
     * @param {[Int]} channels 
     * @param {ELERO_COMMAND} command 
     */
    easySend(channels, command) {

        if (channels === undefined) {
            channels = Array.from({length: 15}, (v, k) => k); 
        }

        this.sendCommand([0xaa, 0x05, 0x4c, this.highChannelBits(channels), this.lowChannelBits(channels), ELERO_COMMAND[command]]);
    }

    easyInfo(channels) {
        this.log("Easy Info");

        if (channels === undefined) {
            channels = Array.from({length: 15}, (v, k) => k); 
        }

        this.sendCommand([0xaa, 0x04, 0x4e, this.highChannelBits(channels), this.lowChannelBits(channels)]);
    }
      
    easyCheck() {
        this.log("Easy Check");
        this.sendCommand([0xaa, 0x02, 0x4a]);
    }
      
    statusReceived(channel, state) {
        this.emit('status', channel, state);
    }

    highChannelBits(channels) {
        return this.channelBits(channels, 8, 7);
    }

    lowChannelBits(channels) {
        return this.channelBits(channels, 0, 8);
    }

    channelBits(channels, offset, count) {

        var bits = 0;
        for (var i = offset; i < (offset + count); i++) {
            if (channels.includes(i)) {
                bits |= 1 << (i - offset);
            }
        }
    }

    decodeChannels(highBits, lowBits) {

        var channels = [];

        for (var i = 0; i < 8; i++) {
            if (lowBits & (1 << i)) {
                channels.push(i);
            }
        }

        for (var i = 8; i < 15; i++) {
            if (highBits & (1 << (i - 8))) {
                channels.push(i);
            }
        }

        return channels;
    }

    getKeyByValue(obj, value) {
        Object.keys(obj).find(key => obj[key] === value);  
    }  
}

module.exports = {

    EleroStickConnection, 
    getInstance: EleroStickConnection.getInstance, 
    
    ELERO_COMMANDS: ELERO_COMMANDS, 
    ELERO_STATES: ELERO_STATES
}