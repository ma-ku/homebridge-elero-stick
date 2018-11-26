'use strict';

const PluginName = "homebridge-elero-stick";
const PlatformName = "EleroStick";

const EleroStickConnection = require('./stick');
const EASY_COMMAND = require('./stick').EASY_COMMAND;

const EventEmitter = require('events').EventEmitter;

let Accessory, Service, Characteristic, UUIDGen;

/**
 * This is the initializer for the javascript module
 */
module.exports = function(homebridge) {

    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform('homebridge-elero-stick', 'EleroStick', EleroStick, true);
};

class EleroStick 
{
    constructor(log, config, api) {

        log("EleroStick platform init");

        // global vars
        this.log = log;
    
        this.name = config['name'];
        this.port = config['port'];
        this.config = config;
        
        // This will store the actual platformAccessory instances, indexed by the channel id
        this.accessories = {};
        
        // An this will store the EleroChannel instance wrapping above accessories,
        // indexed by their UUID
		this.channels = {};
		
        var stick = this;

        this.serialConnection = EleroStickConnection.getInstance(this.log, this.port);

        if (api) {
            this.api = api;
    
            this.api.on('didFinishLaunching', function() {
                            stick.log("Requesting learned channels from stick")
                            stick.serialConnection.easyCheck()

                            stick.serialConnection.on('connect', (channels) => {
                                stick.registerChannels(channels);
                            })

                        }.bind(this));
        }
    }

    channelUUID(channel) {
        return UUIDGen.generate(this.port + ":" + channel)
    }

    /**
     * Receive the learned channels from the linked Elero Stick
     * and creates the corresponding accessory for it, if not already
     * defined. Furhtermore will all registered accessories checked 
     * if they are still attached to a learned channel and eventually
     * will get set to unreachable.
     * 
     * @param {int[]} channels 
     */
    registerChannels(channels) {

        this.log("Stick reported channels: ", channels);

        var stick = this;

        // For each channel we will generate the corresponding 

        channels.forEach(function(channel) {

            var uuid = stick.channelUUID(channel)
            var accessory = stick.channels[uuid]

            // Check if we have a corresponding accessory configuration
            // for that channel that we can use to complement the accessory
            // configuration
            var channelConfig = stick.config.channels[ channel ]
            if (channelConfig === undefined) {
                channelConfig = {}
            }

            // If this accessory is new, we will create a new instance

            if (accessory === undefined) {
                channelConfig[ "channel" ] = channel
                channelConfig[ "uuid" ] = uuid
            
                if (channelConfig["name"] === undefined) {
                    channelConfig[ "name" ] = "Channel " + channel;
                }
                
                stick.doAddAccessoryFromConfig(channelConfig);
            }
            else {
                stick.log("Online: %s [%s]", accessory.displayName);
                stick.trackChannel(new EleroChannel(stick.log, accessory.accessory, stick, channel, false));
            }

        })        
    }

    // Function invoked when homebridge tries to restore cached accessory.
    // Developer can configure accessory at here (like setup event handler).
    // Update current value.
    configureAccessory(platformAccessory) {
        this.log("Configure [%s]", platformAccessory.UUID);
		this.doAddAccessoryFromConfig(platformAccessory.context.config, platformAccessory);
	}
    
	/**
	 * Store an EleroChannel instance internally
	 */
	trackChannel(eleroChannel) {
        this.log("Register [%s] = ", eleroChannel.accessory.UUID, eleroChannel)
        this.channels[ eleroChannel.accessory.UUID ] = eleroChannel
        this.accessories[ eleroChannel.channel ] = eleroChannel.accessory
	}
	
	/**
	 * We are building a platformAccessory from the given configuration
	 * and wrap it into a EleroChannel
	 */
	doAddAccessoryFromConfig(accessoryConfig, cachedPlatformAccessory=null) {
            
        this.log("Checking registry: [%s]", accessoryConfig.uuid)

		const existingAccessory = this.channels[accessoryConfig.uuid];
    	let needToRegisterPlatformAccessory = false;
        
        this.log("doAddAccessoryFromConfig", accessoryConfig.uuid)
        this.log(" - existingAccessory: ", existingAccessory)
        
    	if (cachedPlatformAccessory === null) {
    	
	    	if (existingAccessory) {
	        	cachedPlatformAccessory = existingAccessory.platformAccessory;
	      	} 
	      	else {
        		const uuid = this.channelUUID(accessoryConfig.channel);
        		cachedPlatformAccessory = new Accessory(accessoryConfig.name, uuid);
                needToRegisterPlatformAccessory = true;
                cachedPlatformAccessory.context = {};
      		}
      		
      		cachedPlatformAccessory.context.config = accessoryConfig;
    	}

        this.log(" - needToRegisterPlatformAccessory: ", needToRegisterPlatformAccessory)

    	if (existingAccessory === undefined) {
            this.log(" - creatingAccessory")
            const accessory = new EleroChannel(this.log, cachedPlatformAccessory, this, accessoryConfig.channel, false);
      		this.trackChannel(accessory);
    	}

    	if (needToRegisterPlatformAccessory) {
    		this.log.log(" - Registering accessory [%s]", cachedPlatformAccessory.UUID);
      		this.api.registerPlatformAccessories(PluginName, PlatformName, [cachedPlatformAccessory]);
    	}        
    } 

    // Handler will be invoked when user try to config your plugin.
    // Callback can be cached and invoke when necessary.
    configurationRequestHandler(context, request, callback) {

        this.log("Context: ", JSON.stringify(context));
        this.log("Request: ", JSON.stringify(request));
    
        // Check the request response
        if (request && request.response && request.response.inputs && request.response.inputs.name) {
            this.addAccessory(request.response.inputs.name);
        
            // Invoke callback with config will let homebridge save the new config into config.json
            // Callback = function(response, type, replace, config)
            // set "type" to platform if the plugin is trying to modify platforms section
            // set "replace" to true will let homebridge replace existing config in config.json
            // "config" is the data platform trying to save
            callback(null, "platform", true, {"platform":"SamplePlatform", "otherConfig":"SomeData"});
            return;
        }
    
        // - UI Type: Input
        // Can be used to request input from user
        // User response can be retrieved from request.response.inputs next time
        // when configurationRequestHandler being invoked
    
        var respDict = {
            "type": "Interface",
            "interface": "input",
            "title": "Add Accessory",
            "items": [
                {
                "id": "name",
                "title": "Name",
                "placeholder": "Fancy Light"
                }//, 
                // {
                //   "id": "pw",
                //   "title": "Password",
                //   "secure": true
                // }
            ]
        }
    
        // - UI Type: List
        // Can be used to ask user to select something from the list
        // User response can be retrieved from request.response.selections next time
        // when configurationRequestHandler being invoked
    
        // var respDict = {
        //   "type": "Interface",
        //   "interface": "list",
        //   "title": "Select Something",
        //   "allowMultipleSelection": true,
        //   "items": [
        //     "A","B","C"
        //   ]
        // }
    
        // - UI Type: Instruction
        // Can be used to ask user to do something (other than text input)
        // Hero image is base64 encoded image data. Not really sure the maximum length HomeKit allows.
    
        // var respDict = {
        //   "type": "Interface",
        //   "interface": "instruction",
        //   "title": "Almost There",
        //   "detail": "Please press the button on the bridge to finish the setup.",
        //   "heroImage": "base64 image data",
        //   "showActivityIndicator": true,
        // "showNextButton": true,
        // "buttonText": "Login in browser",
        // "actionURL": "https://google.com"
        // }
    
        // Plugin can set context to allow it track setup process
        context.ts = "Hello";
    
        // Invoke callback to update setup UI
        callback(respDict);
    }    
  
    updateAccessoriesReachability() {
        this.log("Update Reachability");
        for (var index in this.accessories) {
            var accessory = this.accessories[index];
            accessory.updateReachability(false);
        }
    }
  
    removeAccessory(accessory) {

        if (accessory) {
            this.log("[" + accessory.description + "] Removed from HomeBridge.");

            if (this.channels[accessory.UUID]) {
                delete this.channels[accessory.UUID];
            }

	        this.api.unregisterPlatformAccessories(PluginName, PlatformName, [accessory]);
        }
    };

    // Sample function to show how developer can remove accessory dynamically from outside event
    removeAccessories() {
        this.log("Remove Accessories");
        
        this.api.unregisterPlatformAccessories(PluginName, PlatformName, this.accessories);
  
        this.accessories = [];
    }    
}

 
class EleroChannel
{
    constructor(log, accessory, stick, channel, register=true) {
		
		log.log("Accessory: ", accessory);
        
        var info = accessory.getService(Service.AccessoryInformation);

        accessory.context.manufacturer = "Elero";
        info.setCharacteristic(Characteristic.Manufacturer, accessory.context.manufacturer.toString());
    
        accessory.context.model = "Channel " + channel;
        info.setCharacteristic(Characteristic.Model, accessory.context.model.toString());
    
        accessory.context.serial = stick.serial + ":" + channel;
        info.setCharacteristic(Characteristic.SerialNumber, accessory.context.serial.toString());    
    
        this.accessory = accessory;
        this.channel = channel;
        this.log = log;
        this.stick = stick;

        this._lastPosition = 0; // last known position of the blinds, down by default
        this._currentPositionState = 2; // stopped by default
        this._currentTargetPosition = 0; // down by default

        this.registerServices();
    }

    get lastPosition() { return this._lastPosition; }
    get currentPositionState() { return this._currentPositionState; }
    get currentTargetPosition() { return this._currentTargetPosition; }

    set lastPosition(value) {
        this._lastPosition = value;
        this.service.getCharacteristic(Characteristic.CurrentPosition).setValue(this._lastPosition);
    }

    set currentPositionState(value) {
        this._currentPositionState = value;
        this.service.getCharacteristic(Characteristic.PositionState).setValue(this._currentPositionState);
    }

    set currentTargetPosition(value) {
        this._currentTargetPosition = value;
        this.service.getCharacteristic(Characteristic.TargetPosition).setValue(this._currentTargetPosition);
    }

    registerServices() {
    
        this.service = this.accessory.addService(Service.WindowCovering, this.name);
    	
        // the current position (0-100%)
        // https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js#L493
        this.service
            .getCharacteristic(Characteristic.CurrentPosition)
            .on('get', this.getCurrentPosition.bind(this));

        // the position state
        // 0 = DECREASING; 1 = INCREASING; 2 = STOPPED;
        // https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js#L1138
        this.service
            .getCharacteristic(Characteristic.PositionState)
            .on('get', this.getPositionState.bind(this));

        // the target position (0-100%)
        // https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js#L1564
        this.service
            .getCharacteristic(Characteristic.TargetPosition)
            .on('get', this.getTargetPosition.bind(this))
            .on('set', this.setTargetPosition.bind(this));
    }

    getCurrentPosition(callback) {
        this.log('Requested CurrentPosition: %s', this.lastPosition);
        callback(null, this.lastPosition);
    }

    getPositionState(callback) {
        this.log('Requested PositionState: %s', this.currentPositionState);
        callback(null, this.currentPositionState);
    }

    getTargetPosition(callback) {
        this.log('Requested TargetPosition: %s', this.currentTargetPosition);
        callback(null, this.currentTargetPosition);
    }

    getCurrentTiltAngle(callback) {
        callback(null, this.currentTiltAngle);
    }

    getTargetTiltAngle(callback) {
        callback(null, this.currentTargetTiltAngle);
    }

    setTargetPosition(pos, callback) {
        this.log('Set TargetPosition: %d', pos);
        this._currentTargetPosition = pos;

        if (pos == 0) {
            this.stick.serialConnection.easySend([this.channel], EASY_COMMAND.UP)
        }
        else {
            this.stick.serialConnection.easySend([this.channel], EASY_COMMAND.DOWN)

        }
        callback(null);
    }

    getServices() {
        return [this.service];
    }
}
