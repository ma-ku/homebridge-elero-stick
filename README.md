# homebridge-elero-stick

`homebridge-elero-stick` is a plugin for Homebridge that allows controlling Elero (http://www.elero.de) motors for roller shutters and blinds (SunTop, RolTop, VariEco products) wirelessly with the Elero Transmitter Stick (https://www.elero.com/en/products/control-systems/centero/).

## Installation

If you are new to Homebridge, please first read the Homebridge [documentation](https://www.npmjs.com/package/homebridge).

Install homebridge:
```sh
sudo npm install -g homebridge
```
Install homebridge-elero-stick:
```sh
sudo npm install -g homebridge-elero-stick
```

## Configuration

Add the platform in `config.json` in your home directory inside `.homebridge`.

```js
    "platforms": [
      {
        "platform": "EleroStick",
        "name": "EleroStick",
        "port": "/dev/tty.usbserial-A603IUAZ",

        "channels": {
              "0" : {
                  "name": "Window Kitchen",
                  "duration": 24000
              }
        }
      }
    ]
```

The `port` property is required to point to the USB Stick that is mounted as a serial line. Each learned channel (up to 15 channels are supported per stick) will be registered in homebridge. If you want to add additional parameters to a given instance, the `channels` property allows to supply additional properties for each channel, indexed by the channel identifier (0-15).

The following parameters are currently available for a channel:
* **name**: The name of the channel when displayed in Homekit
* **duration**: The duration in milliseconds it takes the shutter to go from the fully closed to the fully open position. This is used to calculate the intermediate positions based on the elapsed time during movements.

## Notes
1. This plugin has been tested with a RolTop motor and due to the lack of motorized blinds, some of the features offered by the Elero Transmitter Stick could not be exercised. 
2. The driver tries to monitor also manually triggered movements (e.g. by moving the shutter using linked controllers instead of using HomeKit). This might not yet be 100% perfect.

Feel free to contribute to make this a better plugin!
