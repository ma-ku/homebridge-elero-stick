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
    NO_INFORMATION:         0x00,
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

        // this.log("Sending Raw Message: ", msg);
        
        this.serial.write(msg, function(err) {
          if (err) {
                this.connectionBusy = false
                return this.log('Error on write: ', err.message);
          }
        });

        var stick = this
        setTimeout(function() {
            stick.sendNext()
        }, 4000)
    }

    sendNext() {
        var command = this.commandQueue.shift()
        if (command !== undefined) {
            this.send(command)
        }
        else {
            this.connectionBusy = false
        }
    }

    incomingData(data) {

        // this.log("Received data ", data);
        
        if (this.checksum(data) == 0) {
            
            var valid = false;

            do {
                // Header
                if (data[0] != 0xAA) break;
                
                if ((data[1] == 0x05) && (data[2] == 0x4D)) {
                    // Easy_Ack
                    var channels = this.decodeChannels(data[3], data[4]);
                    const state = data[5];

                    var conn = this
                    channels.forEach( function(channel) {
                        conn.statusReceived(channel, state);
                    });
                }
                else if ((data[1] == 0x04) && (data[2] == 0x4B)) {
                    // Easy_Confirm
                    this.channels = this.decodeChannels(data[3], data[4]);
                    this.emit('connect', this.channels);
                }
                else break;

            } while (false);
        }
        else {
            this.log("Invalid checksum ", this.checksum(data));
        }

        this.sendNext()
    }

    /**
     * 
     * @param {[Int]} channels 
     * @param {ELERO_COMMAND} command 
     */
    easySend(channels, command) {
        channels = this.checkChannels(channels)
        this.sendCommand([0xaa, 0x05, 0x4c, this.highChannelBits(channels), this.lowChannelBits(channels), command]);
    }

    commandUp(channels) {
        this.log("commandUp", channels)
        this.easySend(channels, ELERO_COMMANDS.UP)
    }

    commandDown(channels) {
        this.log("commandDown", channels)
        this.easySend(channels, ELERO_COMMANDS.DOWN)
    }

    commandStop(channels) {
        this.log("commandStop", channels)
        this.easySend(channels, ELERO_COMMANDS.STOP)
    }

    commandVentilationPosition(channels) {
        this.log("commandVentilationPosition", channels)
        this.easySend(channels, ELERO_COMMANDS.VENT_POS)
    }

    commandIntermediatePosition(channels) {
        this.log("commandIntermediatePosition", channels)
        this.easySend(channels, ELERO_COMMANDS.INTERM_POS)
    }

    easyInfo(channels) {
        this.log("easyInfo", channels)
        channels = this.checkChannels(channels)
        if (channels.length == 0) {
            channels = [ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 ]
        }
        this.sendCommand([0xaa, 0x04, 0x4e, this.highChannelBits(channels), this.lowChannelBits(channels)]);
    }
      
    easyCheck() {
        this.log("Easy Check");
        this.sendCommand([0xaa, 0x02, 0x4a]);
    }
      
    checkChannels(channels) {
        if (channels === undefined) {
            channels = Array.from({length: 15}, (v, k) => k); 
        }
        
        return channels
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

        return bits
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
        return Object.keys(obj).find(key => obj[key] === value);  
    }  
}

module.exports = {
    EleroStickConnection: EleroStickConnection, 
    getInstance: EleroStickConnection.getInstance, 
    ELERO_STATES: ELERO_STATES
}