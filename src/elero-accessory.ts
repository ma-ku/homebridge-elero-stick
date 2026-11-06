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

    protected readonly informationService: Service;
    
    protected services: Service[] = [];

    // This is a marker if we are moving the shutter ourselves. If not, it might have been
    // controlled by a local switch and we will not interfere with that manual control
    isMonitoring: boolean = false;

    reportingInterval: number = 5000;
    
    constructor(
        protected readonly hap: HAP, 
        protected readonly log: Logging, 
        readonly platformConfig: EleroConfiguration, 
        motorConfig: EleroMotorConfig, 
        uuid: string, 
        protected readonly stick: EleroStick, 
        readonly channel: number) {
      
        
        this.name = motorConfig.name;
        this.displayName = motorConfig.displayName || motorConfig.name;
        
        this.uuid = uuid;

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
