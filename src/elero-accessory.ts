import {
    AccessoryPlugin,
    CharacteristicGetCallback,
    CharacteristicSetCallback,
    CharacteristicValue,
    HAP,
    Logging,
    Service,
    CharacteristicEventTypes
} from "homebridge";
import { platform } from "os";
import { EleroConfiguration } from "./elero-configuration";

import { EleroMotorConfig } from './model/elero-motor-config';
import { EleroStick, ELERO_STATES } from './usb/elero-stick';

export abstract class EleroAccessory implements AccessoryPlugin {

    // This property must be existent!!
    name: string;
    displayName: string;  
    uuid: string;

    // Provided by HomeBridge
    protected readonly log: Logging;
    protected readonly hap: HAP;
    
    protected readonly informationService: Service;
    
    reportingInterval: number = 5000;

    protected readonly stick: EleroStick;
    readonly channel: number;

    readonly platformConfig: EleroConfiguration;

    constructor(hap: HAP, log: Logging, platformConfig: EleroConfiguration, motorConfig: EleroMotorConfig, uuid: string, stick: EleroStick, channel: number) {
      
        this.log = log;
        this.hap = hap;
        
        this.platformConfig = platformConfig;
        
        this.name = motorConfig.name;
        this.displayName = motorConfig.displayName || motorConfig.name;
        
        this.uuid = uuid;

        this.stick = stick;
        this.channel = channel;

        this.informationService = new hap.Service.AccessoryInformation()
            .setCharacteristic(hap.Characteristic.Manufacturer, "Elero")
            .setCharacteristic(hap.Characteristic.Model, "Channel " + channel)
            .setCharacteristic(hap.Characteristic.SerialNumber, stick.port + ":" + channel);
    }

    abstract processState(state: number, currentTimestamp: number): void;

    abstract getServices(): Service[];
}
