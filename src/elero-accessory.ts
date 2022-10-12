import {
    AccessoryPlugin,
    HAP,
    Logging,
    Service,
} from "homebridge";

import { EleroConfiguration } from "./elero-configuration";

import { EleroMotorConfig } from './model/elero-motor-config';
import { EleroStick } from './usb/elero-stick';

export abstract class EleroAccessory implements AccessoryPlugin {

    // This property must be existent!!
    name: string;
    displayName: string;  
    uuid: string;

    // Provided by HomeBridge
    protected readonly log: Logging;
    protected readonly hap: HAP;
    
    protected readonly informationService: Service;
    
    protected readonly stick: EleroStick;
    readonly channel: number;

    readonly platformConfig: EleroConfiguration;

    protected services: Service[] = [];

    // This is a marker if we are moving the shutter ourselves. If not, it might have been
    // controlled by a local switch and we will not interfere with that manual control
    isMonitoring: boolean = false;

    reportingInterval: number = 5000;
    
    constructor(hap: HAP, log: Logging, platformConfig: EleroConfiguration, motorConfig: EleroMotorConfig, uuid: string, stick: EleroStick, channel: number) {
      
        this.log = log;
        this.hap = hap;
        
        this.platformConfig = platformConfig;
        
        this.name = motorConfig.name;
        this.displayName = motorConfig.displayName || motorConfig.name;
        
        this.uuid = uuid;

        this.stick = stick;
        this.channel = channel;

        this.reportingInterval = platformConfig.defaultUpdateInterval;

        this.informationService = new hap.Service.AccessoryInformation()
            .setCharacteristic(hap.Characteristic.Manufacturer, "Elero")
            .setCharacteristic(hap.Characteristic.Model, "Channel " + channel)
            .setCharacteristic(hap.Characteristic.SerialNumber, stick.port + ":" + channel);

        this.services.push(this.informationService);
    }

    abstract processState(state: number, currentTimestamp: number): void;

    /**
     * This method is called directly after creation of this instance.
     * It should return all services which should be added to the accessory.
     */
     getServices(): Service[] {
        return this.services;
    }    
}
