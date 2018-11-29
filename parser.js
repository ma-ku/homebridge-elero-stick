'use strict';

/**
 * Defines a custom parser for the SerialPort library that processes
 * the datagrams received from the Elero Stick and collects all data
 * for a single datagram before sending the data back to the caller
 */

const Transform = require('stream').Transform

/**
 * Emit data for a single Elero datagram. The length varies depending on the content header
 * 
 * @extends Transform
 * @param {Object} options parser options object
 * @summary A transform stream that emits data as a buffer after a specific number of bytes are received. Runs in O(n) time.
 * @example
 */
class EleroParser extends Transform {

    constructor(options = {}) {
        super(options)

        // Current position in the receiving buffer
        this.position = 0

        // This is the maximum length of a datagram
        this.maxLength = 7

        // The expected length for the current datagram
        this.length = 0

        // We expect not more than 7 bytes per datagram
        this.buffer = Buffer.alloc(this.maxLength)
    }

  _transform(chunk, encoding, callback) {
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

    _flush(cb) {
        this.push(this.buffer.slice(0, this.position))
        this.buffer = Buffer.alloc(this.maxLength)
        this.position = 0
        cb()
    }
}

module.exports = EleroParser