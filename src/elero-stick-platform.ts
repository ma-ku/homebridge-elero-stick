import {
  AccessoryPlugin, 
  API, 
  HAP, 
  Logging, 
  PlatformConfig, 
  StaticPlatformPlugin,
  PlatformAccessory
} from "homebridge";

import { EleroAccessory } from "./elero-accessory";
import { EleroShutterAccessory } from "./elero-shutter-accessory";
import { EleroStick, ELERO_STATES } from "./usb/elero-stick";
import { PerformanceObserver, performance } from 'perf_hooks';
import { EleroMotorConfig } from './model/elero-motor-config';
import { EleroPlatformConfig } from './model/elero-platform-config';
import { access } from "fs";

const PluginName = "homebridge-elero-stick";

const PLATFORM_NAME = "EleroStick";

const DEFAULT_UPDATEINTERVAL = 5000;
const DEFAULT_MOVINGUPDATEINTERVAL = 1500;

let hap: HAP;

export = (api: API) => {
  hap = api.hap;

  api.registerPlatform(PLATFORM_NAME, EleroStickPlatform);
};

class EleroStickPlatform implements StaticPlatformPlugin {

    private readonly log: Logging;

    private name: string;

    private port: string;

    private readonly api: API;
    private readonly serialConnection: EleroStick;

    private config: EleroPlatformConfig;

    private eleroAccessories: Map<string, EleroAccessory> = new Map<string, EleroAccessory>();
    private channelIds: number[] = [];

    private defaultUpdateInterval: number = 5000;
    private movingUpdateInterval: number = 1500;

    private updateInterval: number = 5000;

    private lastStatusTimestamp: number;

    private hasCallback: boolean = false;
    private accessoriesCallback: (foundAccessories: AccessoryPlugin[]) => void;

    constructor(log: Logging, config: PlatformConfig, api: API) {

        this.log = log;
        this.api = api;

        // Dummy-Callback
        this.accessoriesCallback = this.dummy;

        this.config = this.checkConfig(config);

        this.name = this.config['name'] || "";
        this.port = this.config['port'];

        // We will request an update from the stick every 5 seconds
        this.defaultUpdateInterval = this.config.updateInterval || 5000;
        this.movingUpdateInterval =  this.config.movingUpdateInterval || 1500;

        this.updateInterval = this.defaultUpdateInterval;

        this.lastStatusTimestamp = performance.now()

        // This will store the actual platformAccessory instances, indexed by their uuid
        // this.accessories = {};
        
        var stick = this;

        this.serialConnection = new EleroStick(this.port, (config.debugSerial ? this.log : undefined));

        if (api) {
            this.api = api;

            this.api.on('didFinishLaunching', () => {

                            this.log.info("Requesting learned channels from stick")

                            this.serialConnection.on('connect', (channels: number[]) => {
                                this.registerChannels(channels);
                            })
                    
                            this.serialConnection.on('status', (channel: number, state: number) => {
                                stick.processState(channel, state);
                            })
                    
                            this.serialConnection.easyCheck();

                            this.checkChannelStates();
                        });
        }
    }

    /**
     * This method is called to retrieve all accessories exposed by the platform.
     * The Platform can delay the response my invoking the callback at a later time,
     * it will delay the bridge startup though, so keep it to a minimum.
     * The set of exposed accessories CANNOT change over the lifetime of the plugin!
     */
    public accessories(callback: (foundAccessories: AccessoryPlugin[]) => void): void {
        this.accessoriesCallback = callback;
        this.hasCallback = true;

        this.publishAccessories();
    }

    protected dummy(foundAccessories: AccessoryPlugin[]) {

    }

    protected publishAccessories() {

        if ((this.hasCallback) && (this.eleroAccessories.size > 0)) {

            this.log.debug('>> Request for accessories');
            this.log.debug('>> # of Elero accessories is ' + this.eleroAccessories.size);
    
            let accessories: AccessoryPlugin[] = []
            this.eleroAccessories.forEach( value => {
                accessories.push( <AccessoryPlugin><unknown>value );
            })
            
            this.accessoriesCallback(accessories);
        }
    }
    
    protected checkConfig(config: PlatformConfig): EleroPlatformConfig {
        
        this.log.debug("User-Config:\n" + JSON.stringify(config));

        let result: EleroPlatformConfig = {
            name: config['name'] || 'EleroStick',
            port: config['port'] || '/dev/ttyUSB0',

            debugSerial: config['debugSerial'],

            updateInterval: config['updateInterval'] || DEFAULT_UPDATEINTERVAL,
            movingUpdateInterval: config['movingUpdateInterval'] || DEFAULT_MOVINGUPDATEINTERVAL,
        
            motors: {}
        }

        config.motors = config.motors || []
        config.motors.forEach( (userConfig: EleroMotorConfig) => {
            
            this.log.debug("Motor-User-Config:\n" + JSON.stringify(userConfig));

            let motorConfig: EleroMotorConfig = {
                type: userConfig['type'] || 'shutter',
                channel: userConfig['channel'],
                name: userConfig['name'] || "Channel " + userConfig['channel'],
                displayName: userConfig['displayName'] || "Channel " + userConfig['channel'],
                duration: userConfig['duration'] || 10000,
                reverse: userConfig['reverse'] || false
            }

            result.motors[ motorConfig.channel ] = motorConfig;
        });

        this.log.debug("Result-Config:\n" + JSON.stringify(result));

        return result;
    }

    /**
     * This is a callback from an easyInfo call to the EleroStick. Since other than described in the documentation,
     * the stick is not requesting the state for each channel sent in the command, we are requesting the state 
     * individually for each channel and thus receive multiple responses.
     * 
     * @param {int} channel 
     * @param {int} state 
     */
    protected processState(channel: number, state: number) {
        var newTimestamp = performance.now()
        var newInterval = this.updateInterval

        this.eleroAccessories.forEach( accessory => {
            if (accessory.channel == channel) {
                accessory.processState(state, newTimestamp, this.defaultUpdateInterval, this.movingUpdateInterval);
            }
        });

        
        // Find minimum monitoring time
        newInterval = this.defaultUpdateInterval
        
        this.eleroAccessories.forEach( accessory => {
            newInterval = Math.min( newInterval, accessory.reportingInterval);
        });

        this.updateInterval = newInterval
        this.lastStatusTimestamp = newTimestamp
    }

    protected channelUUID(channel: number) {
        return hap.uuid.generate(this.port + ":" + channel)
    }

    protected checkChannelStates() {

        var stick = this

        if (isNaN(this.updateInterval)) {
            this.updateInterval = this.defaultUpdateInterval
        }

        this.log.debug('checkChannelStates (%s ms)', this.updateInterval);

        setTimeout(function() {
            stick.serialConnection.easyInfo(stick.channelIds)
            stick.checkChannelStates()
        }, Math.max(500, this.updateInterval))
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
    protected registerChannels(channels: number[]): void {

        this.log.info("Stick reported channels: ", channels);

        this.channelIds = channels
        var stick = this

        // For each channel we will generate the corresponding EleroChannel that is
        // then linked with a matching implementation (for now only Shutters)
        channels.forEach((channel: number) => {

            // Do we already have an accessory for this?
            var uuid = stick.channelUUID(channel);

            // Check if we have a corresponding accessory configuration
            // for that channel that we can use to complement the accessory
            // configuration
            var channelConfig: EleroMotorConfig = stick.config.motors[ channel ] || {
                                                                                        type: 'shutter',
                                                                                        channel: channel,
                                                                                        name: 'Channel ' + channel
                                                                                    };

            // If this accessory is new, we will create a new instance

            var accessory: EleroAccessory;

            switch (channelConfig.type) {
            case 'shades':
            case 'shutter':
                accessory = new EleroShutterAccessory(this.api.hap, this.log, channelConfig, uuid, this.serialConnection, channel);
            }

            if (accessory) {
                this.eleroAccessories.set(accessory.uuid, accessory)
            }
            else {
                stick.log.error("Cannot add accessory for channel: %s", channel);
            }
        })    
        
        this.publishAccessories();
    }
}
