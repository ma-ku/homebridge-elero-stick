# homebridge-elero-stick

`homebridge-elero-stick` is a plugin for Homebridge that allows controlling Elero (http://www.elero.de) motors for roller shutters and blinds (SunTop, RolTop, VariEco products) wirelessly with the Elero Transmitter Stick (https://www.elero.com/en/products/control-systems/centero/).

Control your `http`-based blinds via Homebridge!

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
                  "name": "Window Kitchen"
              }
        }
      }
    ]
```

The `port` property is required to point to the USB Stick that is mounted as a serial line. Each learned channel (up to 15 channels are supported per stick) will be registered in homebridge. If you want to add additional parameters to a given instance, the `channels` property allows to supply additional properties for each channel, indexed by the channel identifier (0-15) 
## Note
This plugin has been tested with a RolTop motor and due to the lack of motorized blinds, some of the features offered by the Elero Transmitter Stick could not be exercised. 

Feel free to contribute to make this a better plugin!
