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

Add the platform in `config.json` in your home directory inside `.homebridge`. Alternatively you can use the Config UI to change the values 

```js
    "platforms": [
      {
        "platform": "EleroStick",
        "name": "EleroStick",
        "port": "/dev/tty.usbserial-A603IUAZ",
        "updateInterval": 3500,
        "movingUpdateInterval": 1500,

        "motors": [
          {
            "channel": 1,
            "type": "shutter",
            "name": "Window Kitchen",
            "duration": 24000
          }
        ]
      }
    ]
```

The `port` property is required to point to the USB Stick that is mounted as a serial line. Each learned channel (up to 15 channels are supported per stick) will be registered in homebridge. If you want to add additional parameters to a given instance, the `channels` property allows to supply additional properties for each channel, indexed by the channel identifier (0-15).

Since the motors are ectively monitored by the plugin, the intervals can be configured. If no motor is detected as moving, then the **updateInterval** will be applied. This is useful for the plugin to detect movements that were triggered by other remotes. Once at least one motor is detected as moving, the frequency will be change to **movingUpdateInterval** to allow finer control of the movements. All values are milliseconds and must be greater than zero.

The following parameters are currently available for a channel:
* **name**: The name of the channel when displayed in Homekit
* **type**: Type of controlled device. Allowed values are: **shutter**, **shades**, **heating**, and **lights**.
* **duration**: The duration in milliseconds it takes the shutter to go from the fully closed to the fully open position. This is used to calculate the intermediate positions based on the elapsed time during movements.
* **startDelay**: This is an optional value that allows the plugin to compensate for motors that start with delay or slow acceleration.
* **reverse**: The motor is moving in reverse direction so that open and closed state will be reported inverted. 

## Notes
1. This plugin has been tested with a RolTop motor and due to the lack of motorized blinds, some of the features offered by the Elero Transmitter Stick could not be exercised. 
2. The driver tries to monitor also manually triggered movements (e.g. by moving the shutter using linked controllers instead of using HomeKit). This might not yet be 100% perfect.

## Troubleshooting
* Check if the motors are in bi-directional mode.
* Try to control each motor directly from the Elero-Stick.
* Create a detailed log to help tracing bugs.

## Logging
**NOTE**: Logs may contain sensitive data such as passwords or authentication tokens. Please review the logs before sharing them with others.

This plugin already provides logs for the general behavior of the plugin. By enabling the `-D` option running HomeBridge, you will get also detailed information about internal decision making and timings that help to improved the settings for your Elero stick. If that is not sufficient, you can also enable logging of the serial communication between the plugin and the Elero stick. Add `"debugSerial": true` to the platform configuration and restart. Since debug logging produces a significant amount of
data, you should only turn it on for a limited time. 

Feel free to contribute to make this a better plugin!
