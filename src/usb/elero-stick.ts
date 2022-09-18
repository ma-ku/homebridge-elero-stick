import { Logging } from "homebridge";
import { EventEmitter } from 'events';
import SerialPort from 'serialport'

enum ELERO_COMMANDS {
    UP =                    0x20,
    INTERM_POS =            0x44,
    VENT_POS =              0x24,
    DOWN =                  0x40,
    STOP =                  0x10  
};

export enum ELERO_STATES {
    NO_INFORMATION =        0x00,
    TOP_POS_STOP =          0x01,
    BOTTOM_POS_STOP =       0x02,
    INTERM_POS_STOP =       0x03,
    TILT_POS_STOP =         0x04,
    BLOCKING =              0x05,
    OVERHEATED =            0x06,
    TIMEOUT =               0x07,
    START_MOVE_UP =         0x08,
    START_MOVE_DOWN =       0x09,
    MOVING_UP =             0x0A,
    MOVING_DOWN =           0x0B,
    STOP_UNDEFINED_POS =    0x0D,
    TOP_VENT_POS_STOP =     0x0E,
    BOTTOM_INTERM_POS_STOP =0x0F,
    SWITCHING_DEVICE_OFF =  0x10,
    SWITCHING_DEVICE_ON =   0x11
 };

const DEFAULT_BAUDRATE = 38400
const DEFAULT_BYTESIZE = 8
const DEFAULT_PARITY = 'none'
const DEFAULT_STOPBITS = 1

export declare interface EleroStick {
    on(event: 'connect', listener: (channels: number[]) => void): this;
    on(event: 'status', listener: (channel: number, state: number) => void): this;
}

function hex(data: Uint8Array | number[]) : string {

    let msg = "[";
    data.forEach( d => { msg += d.toString(16).padStart(2,'0') + " "; });
    msg += "]";

    return msg;
}

export class EleroStick extends EventEmitter {

    private readonly log?: Logging;

    readonly port: string;

    public sendInterval: number = 250;

    private serial: SerialPort;
    private parser: EleroParser;

    private connectionBusy: boolean = false;
    private commandQueue: number[][] = [];
    
    private channels: number[] = [];

    constructor(port: string, log?: Logging) {
        super();

        this.log = log;
        this.port = port;

        if (this.log) this.log.info('Logging enabled for EleroStick');

        this.serial = new SerialPort(port, 
                                     {
                                        baudRate: DEFAULT_BAUDRATE,
                                        dataBits: DEFAULT_BYTESIZE,
                                        parity: DEFAULT_PARITY,
                                        stopBits: DEFAULT_STOPBITS,
                                        autoOpen: false,
                                     })

        // We put a parser into place to check for valid
        // Elero responses and that emits only full response packages
        this.parser = this.serial.pipe(new EleroParser(this.log))

        this.parser.on('data', (data) => {
                            this.incomingData(data);
                        })
                    
                    .on('connect', () => {
                            if (this.log) this.log.debug("Serial port connected");
                        })
                        
                    .on('close', () => {
                            if (this.log) this.log.debug("Serial port closed");
                            this.serial.open();
                        });                                     
        
        this.serial.open();
    }

    private checksum(data: number[]): number {

        var sum = 0;
        data.forEach(element => {
            sum += element;
        });
      
        return sum & 0xff;
    }

    private sendCommand(command: number[], urgent: boolean = false): void {

        if (this.connectionBusy) {
            if (urgent == true) {
                this.commandQueue.unshift(command);
            }
            else {
                this.commandQueue.push(command);
            }
        } 
        else {
            this.connectionBusy = true;
            this.send(command);
        }
    }

    private _currentTimer: NodeJS.Timeout | undefined = undefined;

    private send(data: number[]): void {

        if (this._currentTimer) {
            clearTimeout(this._currentTimer);
            this._currentTimer = undefined;
        }

        var msg = data; 

        // Compute checksum byte for the message
        var checksum = this.checksum(data);
        var csByte = 0x100 - (checksum & 0xff);
        msg[data.length] = csByte

        this.serial.write(msg, (err) => {
          if (err) {
            this.connectionBusy = false;
            if (this.log) this.log.error('Error on write: ', err.message);
                return 
          }
        });

        var stick = this
        this._currentTimer = setTimeout( () => {
            stick.sendNext()
        }, this.sendInterval);
    }

    private sendNext(): void {
        var command = this.commandQueue.shift();
        if (command) {
            this.send(command);
        }
        else {
            this.connectionBusy = false;
        }
    }

    /**
     * 
     * @param {[number]} channels 
     * @param {ELERO_COMMAND} command 
     * @param {[Boolean]} urgent 
     */
    private easySend(channels: number[], command: number, urgent: boolean = false): void {
        channels = this.checkChannels(channels)

        this.sendCommand([0xaa, 0x05, 0x4c, this.highChannelBits(channels), this.lowChannelBits(channels), command], urgent || false);
    }

    public commandUp(channels: number[]): void {
        if (this.log) this.log.debug("commandUp", channels)
        this.easySend(channels, ELERO_COMMANDS.UP, true);
    }

    public commandDown(channels: number[]): void {
        if (this.log) this.log.debug("commandDown", channels)
        this.easySend(channels, ELERO_COMMANDS.DOWN, true)
    }

    public commandStop(channels: number[]): void {
        if (this.log) this.log.debug("commandStop", channels)
        this.easySend(channels, ELERO_COMMANDS.STOP, true)
    }

    public commandVentilationPosition(channels: number[]): void {
        if (this.log) this.log.debug("commandVentilationPosition", channels)
        this.easySend(channels, ELERO_COMMANDS.VENT_POS, true)
    }

    public commandIntermediatePosition(channels: number[]): void {
        if (this.log) this.log.debug("commandIntermediatePosition", channels)
        this.easySend(channels, ELERO_COMMANDS.INTERM_POS, true)
    }

    public easyInfo(channels: number[]): void {
        if (this.log) this.log.debug("easyInfo", channels)
        channels = this.checkChannels(channels)
        if (channels.length == 0) {
            channels = [ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 ]
        }

        var index = 0;
        for (index = 0; index < channels.length; ++index) {
            this.sendCommand([0xaa, 0x04, 0x4e, this.highChannelBits([channels[index]]), this.lowChannelBits([channels[index]])]);
        }
    }
      
    public easyCheck() {
        if (this.log) this.log.debug("Easy Check");
        this.sendCommand([0xaa, 0x02, 0x4a]);
    }
      

    private incomingData(data: number[]): void {

        if (this.log) this.log.debug("Incoming data: " + hex(data));

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
                    channels.forEach( channel => {
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
            if (this.log) this.log.error("Invalid checksum ", this.checksum(data));
        }

        this.sendNext()
    }

    private checkChannels(channels: number[]): number[] {
        return channels || Array.from({length: 15}, (v, k) => k); 
    }

    protected statusReceived(channel: number, state: number) {
        if (this.log) this.log.debug("Status of channel %d: %s", channel, ELERO_STATES[state]);
        this.emit('status', channel, state);
    }

    protected highChannelBits(channels: number[]): number {
        return this.channelBits(channels, 8, 7);
    }

    protected lowChannelBits(channels: number[]): number {
        return this.channelBits(channels, 0, 8);
    }

    protected channelBits(channels: number[], offset: number, count: number): number {

        var bits = 0;
        for (var i = offset; i < (offset + count); i++) {
            if (channels.includes(i)) {
                bits |= 1 << (i - offset);
            }
        }

        return bits
    }

    protected decodeChannels(highBits: number, lowBits: number): number[] {

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

    protected getKeyByValue(obj: any, value: string): any {
        return Object.keys(obj).find(key => obj[key] === value);  
    }  
}

/**
 * Defines a custom parser for the SerialPort library that processes
 * the datagrams received from the Elero Stick and collects all data
 * for a single datagram before sending the data back to the caller
 */

import { Transform, TransformCallback } from 'stream';

/**
 * Emit data for a single Elero datagram. The length varies depending on the content header
 * 
 * @extends Transform
 * @param {Object} options parser options object
 * @summary A transform stream that emits data as a buffer after a specific number of bytes are received. Runs in O(n) time.
 * @example
 */
export class EleroParser extends Transform {

    protected position: number;
    protected maxLength: number;
    protected length: number;
    protected buffer: Buffer;

    protected readonly log?: Logging;

    constructor(log?: Logging) {
        super();

        this.log = log;

        // Current position in the receiving buffer
        this.position = 0

        // This is the maximum length of a datagram
        this.maxLength = 7

        // The expected length for the current datagram
        this.length = 0

        // We expect not more than 7 bytes per datagram
        this.buffer = Buffer.alloc(this.maxLength)
    }

    _transform(chunk: any, encoding: string, callback: TransformCallback): void {

        if (this.log) this.log.debug('Received data from elero stick: ' + hex(chunk));

        let cursor = 0  
        while (cursor < chunk.length) {
            this.buffer[this.position] = chunk[cursor]
            cursor++

            // Check if this is an Elero message, if not, flush the data
            if (this.position == 0) {
                if (this.buffer[0] != 0xAA) {
                    this.push(this.buffer)
                    this.buffer = Buffer.alloc(this.maxLength)
                    this.position = 0

                    continue
                }
            }

            // When the second byte is received, we can determine the length
            // of the payload and add one header byte and one checksum byte
            if (this.position == 1) {
                this.length = 1 + this.buffer[1] + 1;
            }
            
            // We can proceed
            this.position++

            // Check if we read all data 
            if (this.position == this.length) {
                this.push(this.buffer)
                this.buffer = Buffer.alloc(this.maxLength)
                this.position = 0
            }
        }

        callback()
    }

    _flush(callback: TransformCallback): void {

        this.push(this.buffer.slice(0, this.position))
        this.buffer = Buffer.alloc(this.maxLength)
        this.position = 0

        callback()
    }
}
