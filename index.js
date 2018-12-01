'use strict';

const PluginName = "homebridge-elero-stick";
const PlatformName = "EleroStick";

const EleroStickConnection = require('./stick').EleroStickConnection;
const ELERO_STATES = require('./stick').ELERO_STATES;

const { PerformanceObserver, performance } = require('perf_hooks');
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
        
        // We will request an update from the stick every 5 seconds
        this.defaultUpdateInterval = 5000
        this.updateInterval = this.defaultUpdateInterval
        this.movingUpdateInterval = 1000

        this.lastStatusTimestamp = performance.now()

        // This will store the actual platformAccessory instances, indexed by their uuid
        this.accessories = {};
        
        // An this will store the EleroChannel instance wrapping above accessories,
        // indexed by their channel number
	    this.channels = {};
        this.channelIds = [];
        
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

                            stick.serialConnection.on('status', (channel, state) => {
                                stick.processState(channel, state);
                            })

                            stick.checkChannelStates()

                        }.bind(this));
        }
    }

    channelUUID(channel) {
        return UUIDGen.generate(this.port + ":" + channel)
    }

    checkChannelStates() {

        var stick = this

        if (isNaN(this.updateInterval)) {
            this.updateInterval = this.defaultUpdateInterval
        }

        setTimeout(function() {
            stick.serialConnection.easyInfo(stick.channelIds)
            stick.checkChannelStates()
        }, Math.max(1000, this.updateInterval))
    }

    processState(channel, state) {
        var newTimestamp = performance.now()
        var newInterval = this.updateInterval
        var first = true

        if (this.channels[ channel ] !== undefined) {
            this.channels[ channel ].processState(state, newTimestamp)
        
            if (first) {
                newInterval = this.channels[ channel ].reportingInterval
                first = false
            }
            else {
                newInterval = Math.min(newInterval, this.channels[ channel ].reportingInterval)
            }
        }

        if (isNaN(newInterval)) {
            newInterval = this.defaultUpdateInterval
        }

        this.updateInterval = newInterval
        this.lastStatusTimestamp = newTimestamp
    }

    /**
     * Receive the learned channels from the linked Elero Stick
     * and creates the corresponding accessory for it, if not already
     * defined. Furthermore will all registered accessories checked 
     * if they are still attached to a learned channel and eventually
     * will get set to unreachable.
     * 
     * @param {int[]} channels 
     */
    registerChannels(channels) {

        this.log("Stick reported channels: ", channels);

        this.channelIds = channels
        var stick = this

        // For each channel we will generate the corresponding 

        channels.forEach(function(channel) {

            var uuid = stick.channelUUID(channel)
            var accessory = stick.accessories[uuid]

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

                if (channelConfig["duration"] === undefined) {
                    channelConfig[ "duration" ] = 0
                }

                if (channelConfig["name"] === undefined) {
                    channelConfig[ "name" ] = "Channel " + channel
                }

                stick.doAddAccessoryFromConfig(channelConfig);
            }
            else {
                stick.log("Online: %s", accessory.displayName);
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
        this.channels[ eleroChannel.channel ] = eleroChannel
        this.accessories[ eleroChannel.UUID ] = eleroChannel.accessory
	}
	
	/**
	 * We are building a platformAccessory from the given configuration
	 * and wrap it into a EleroChannel
	 */
	doAddAccessoryFromConfig(accessoryConfig, accessory=null) {
            
	    const existingAccessory = this.accessories[accessoryConfig.uuid];
    	let needToRegisterPlatformAccessory = false;
        
        // This is the case if the accessory needs to be created from config
    	if (accessory === null) {
    	
	    	if (existingAccessory) {
	        	accessory = existingAccessory.platformAccessory;
	      	} 
	      	else {
        		const uuid = this.channelUUID(accessoryConfig.channel);
        		accessory = new Accessory(accessoryConfig.name, uuid);
	            accessory.context = {};

	            needToRegisterPlatformAccessory = true;
      		}
              
	        // Updating the config in the accessory
      		accessory.context.config = accessoryConfig;
    	}
        else {
            // Check if we need to amend an existing config?
            var channelConfig = this.config.channels[ accessoryConfig.channel ]
            if (channelConfig === undefined) {
                channelConfig = {}
            }
    
            if (channelConfig["duration"] !== undefined) {
                accessoryConfig.duration = channelConfig["duration"]
            }
            else {
                accessoryConfig.duration = 0
            }

            if (channelConfig["name"] !== undefined) {
                accessoryConfig.name = channelConfig["name"]
            }
        }

    	if (existingAccessory === undefined) {
            const eleroChannel = new EleroChannel(this.log, accessory, this, accessoryConfig.channel);
		    this.trackChannel(eleroChannel);
    	}

    	if (needToRegisterPlatformAccessory) {
      		this.api.registerPlatformAccessories(PluginName, PlatformName, [accessory]);
    	}        
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
            this.log("[" + accessory.description + "] Removed from HomeBridge.")

            if (this.accessories[accessory.UUID]) {
                delete this.accessories[accessory.UUID]
            }

            if (this.channels[accessory.context.config.channel]) {
                delete this.channels[accessory.context.config.channel]
            }

		this.api.unregisterPlatformAccessories(PluginName, PlatformName, [accessory])
        }
    };

    // Sample function to show how developer can remove accessory dynamically from outside event
    removeAccessories() {
        this.log("Remove Accessories");
        
        this.api.unregisterPlatformAccessories(PluginName, PlatformName, this.accessories)
  
        this.accessories = {}
        this.channels = {}
    }    
}

/**
 * This class represents a single channel, connected to an Elero motor. Currently not all features 
 * offered by the Stick are implemented as testing was only done with a RolTop shutter motor. Features
 * such as Ventialation Position or Intermediate Position are not supported by that type of motor as well
 * as the corresponding states are not reported back.
 */
class EleroChannel
{
    constructor(log, accessory, stick, channel) {
		
        var info = accessory.getService(Service.AccessoryInformation);

        accessory.context.manufacturer = "Elero";
        info.setCharacteristic(Characteristic.Manufacturer, accessory.context.manufacturer.toString());
    
        accessory.context.model = "Channel " + channel;
        info.setCharacteristic(Characteristic.Model, accessory.context.model.toString());
    
        accessory.context.serial = stick.port + ":" + channel;
        info.setCharacteristic(Characteristic.SerialNumber, accessory.context.serial.toString());    
    
        this.accessory = accessory;
        this.channel = channel;
        this.UUID = accessory.UUID
        this.log = log;
        this.stick = stick;
        this.reportingInterval = 5000

        // Time of the shutter to move from 0 to 100
        this._duration = accessory.context.config.duration

        // This is a marker if we are moving the shutter ourselves. If not, it might have been
        // controlled by a local switch and we will not interfere with that manual control
        this.isMonitoring = false
        
        this._positionHeld = 0;
        this._lastPosition = 0; // last known position of the blinds, down by default
        this._currentPositionState = 2; // stopped by default
        this._currentTargetPosition = 0; // down by default
        this._lastStatusTimestamp = performance.now()

        this.registerServices();
    }

    processState(state, currentTimestamp) {

        var newState = Characteristic.PositionState.STOPPED
        var newPosition = this._lastPosition
        var newTargetPosition = this._currentTargetPosition

        var newInterval = this.updateInterval

        if (this._currentPositionState != Characteristic.PositionState.STOPPED) {
            // We are moving so figure out the elapsed time
            // and adjust the lastPosition accordingly.

            var direction = 1
            var check = (position, targetPosition) => { return (position >= targetPosition); }

            if (this._currentPositionState == Characteristic.PositionState.DECREASING) {
                direction = -1
                check = (position, targetPosition) => { return (position <= targetPosition); }
            }

            if (!this.isMonitoring) {
                // We will not interrupt
                check = (position, targetPosition) => { return false; }
            }

            var elapsed = (currentTimestamp - this._lastStatusTimestamp)

            if (elapsed >= 1) {

                if (this._duration > 0) {
                    var delta = Math.max(0, 100 * elapsed / this._duration)
                    var newPosition = Math.min(100, Math.max(0, this._lastPosition + direction * delta))
                    this.updateLastPosition(newPosition)

                    // If we are driving to an intermediate position, we need to stop 
                    // ourselves
                    if (check(newPosition, this._currentTargetPosition)) {
                        this.stick.serialConnection.commandStop([this.channel])
                        this.isMonitoring = false
                    }
                }

                this._lastStatusTimestamp = currentTimestamp
            }
        }

        if (state == ELERO_STATES.BOTTOM_POS_STOP) {
            newState = Characteristic.PositionState.STOPPED
            newPosition = 0
            newTargetPosition = 0
            newInterval = this.stick.defaultUpdateInterval

            this.isMonitoring = false
        }
        else if (state == ELERO_STATES.TOP_POS_STOP) {
            newState = Characteristic.PositionState.STOPPED
            newPosition = 100
            newTargetPosition = 100
            newInterval = this.stick.defaultUpdateInterval

            this.isMonitoring = false
        }
        // Not supported/tested for now, might be verified later with
        // the right motor available?!

        // else if (state == ELERO_STATES.TOP_VENT_POS_STOP) {
        //     newState = Characteristic.PositionState.STOPPED
        //     newPosition = 33
        //     newTargetPosition = 33
        //     newInterval = this.stick.defaultUpdateInterval
        // }
        // else if (state == ELERO_STATES.BOTTOM_INTERM_POS_STOP) {
        //     newState = Characteristic.PositionState.STOPPED
        //     newPosition = 67
        //     newTargetPosition = 67
        //     newInterval = this.stick.defaultUpdateInterval
        // }
        else if (state == ELERO_STATES.MOVING_DOWN) {
            newState = Characteristic.PositionState.DECREASING
            newInterval = this.stick.movingUpdateInterval
        }
        else if (state == ELERO_STATES.MOVING_UP) {
            newState = Characteristic.PositionState.INCREASING
            newInterval = this.stick.movingUpdateInterval
        }
        else if (state == ELERO_STATES.START_MOVE_DOWN) {
            newState = Characteristic.PositionState.DECREASING
            newInterval = this.stick.movingUpdateInterval
        }
        else if (state == ELERO_STATES.START_MOVE_UP) {
            newState = Characteristic.PositionState.INCREASING
            newInterval = this.stick.movingUpdateInterval
        }
        else if (state == ELERO_STATES.BLOCKING) {
            newState = Characteristic.PositionState.STOPPED
            newInterval = this.stick.defaultUpdateInterval

            this.isMonitoring = false
        }
        else if (state == ELERO_STATES.OVERHEATED) {
            newState = Characteristic.PositionState.STOPPED
            newInterval = this.stick.defaultUpdateInterval

            this.isMonitoring = false
        }
        else if (state == ELERO_STATES.STOP_UNDEFINED_POS) {
            newState = Characteristic.PositionState.STOPPED
            newInterval = this.defaultUpdateInterval

            this.isMonitoring = false
        }

        this._lastStatusTimestamp = currentTimestamp

        this.updateLastPosition(newPosition)
        this.updateTargetPosition(newTargetPosition)
        this.updatePositionState(newState)

        this.reportingInterval = newInterval
    }

    get lastPosition() { return this._lastPosition; }
    get currentPositionState() { return this._currentPositionState; }
    get currentTargetPosition() { return this._currentTargetPosition; }

    updateLastPosition(value) {
        // this.log("Updating lastPosition: ", this._lastPosition)
        this._lastPosition = value
        this.service.getCharacteristic(Characteristic.CurrentPosition)
                    .updateValue(this._lastPosition);
    }

    updateTargetPosition(value) {
        // this.log("Updating currentTargetPosition: ", this._currentTargetPosition)
        this._currentTargetPosition = value
        this.service.getCharacteristic(Characteristic.TargetPosition)
                    .updateValue(this._currentTargetPosition);
    }

    updatePositionState(value) {
        // this.log("Updating currentPositionState: ", this._currentPositionState)
        this._currentPositionState = value
        this.service.getCharacteristic(Characteristic.PositionState)
                    .updateValue(this._currentPositionState);
    }

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

    set holdPosition(value) {
        this._positionHeld = value;
        this.service.getCharacteristic(Characteristic.HoldPosition).setValue(this._positionHeld);
    }

    registerServices() {
    
        this.service = this.accessory.getService(Service.WindowCovering)

        if ((this.service === null) || (this.service === undefined)) {
            this.service = this.accessory.addService(Service.WindowCovering, this.name);
        }

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

        // Hold Position stopps the service
        // https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js#L855
        this.service
            .getCharacteristic(Characteristic.HoldPosition)
            .on('get', this.getHoldPosition.bind(this))
            .on('set', this.setHoldPosition.bind(this));
    }

    getHoldPosition(callback) {
        this.log('Requested HoldPosition: %s', this._positionHeld);
        callback(null, this._positionHeld);
    }

    setHoldPosition(value, callback) {
        this.log('Set HoldPosition: ', value);

        if (value == 1) {
            this.stick.serialConnection.commandStop([this.channel])
        }

        this._positionHeld = value

        callback(null);
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

    setTargetPosition(pos, callback) {
        this.log('Set TargetPosition: %d', pos);
        this._currentTargetPosition = pos;
        this.positionHeld = 0

        if ((pos <= this._lastPosition) || (pos <= 10)) {
            this.stick.serialConnection.commandDown([this.channel])
        }
        // else if (pos <= 50) {
        //     this.stick.serialConnection.commandIntermediatePosition([this.channel])
        // }
        // else if (pos <= 75) {
        //     this.stick.serialConnection.commandVentilationPosition([this.channel])
        // }
        else {
            this.stick.serialConnection.commandUp([this.channel])
        }

        this.reportingInterval = this.stick.movingUpdateInterval
        this.isMonitoring = true

        callback(null);
    }

    getServices() {
        return [this.service];
    }
}
