const Transform = require('stream').Transform

/**
 * Emit data every number of bytes
 * @extends Transform
 * @param {Object} options parser options object
 * @summary A transform stream that emits data as a buffer after a specific number of bytes are received. Runs in O(n) time.
 * @example
 */
class EleroParser extends Transform {

  constructor(options = {}) {
    super(options)

    this.position = 0
    this.maxLength = 7
    this.length = 0

    // We expect not more than 5 bytes per datagram
    this.buffer = Buffer.alloc(this.maxLength)
  }

  _transform(chunk, encoding, cb) {
    let cursor = 0
    while (cursor < chunk.length) {
      this.buffer[this.position] = chunk[cursor]
      cursor++
      this.position++

      // Check if this is an Elero message, if not, flush the data
      if (this.position == 1) {
        if (this.buffer[0] != 0xAA) {
            this.push(this.buffer)
            this.buffer = Buffer.alloc(this.length)
            this.position = 0

            continue
        }
      }

      // Determine length of payload and add one header byte and one checksum byte
      if (this.position == 2) {
        this.length = 1 + this.buffer[1] + 1;
      }

      if (this.position === this.length) {
        this.push(this.buffer)
        this.buffer = Buffer.alloc(this.length)
        this.position = 0
      }
    }
    cb()
  }

  _flush(cb) {
    this.push(this.buffer.slice(0, this.position))
    this.buffer = Buffer.alloc(this.maxLength)
    cb()
  }
}

module.exports = EleroParser