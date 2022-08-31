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

import { EleroAccessory } from './elero-accessory';

import { performance } from 'perf_hooks';
import { EleroMotorConfig } from "./model/elero-motor-config";
import { EleroStick, ELERO_STATES } from "./usb/elero-stick";

export class EleroShutterAccessory extends EleroAccessory {

    protected readonly windowCoveringService: Service;

    // Time of the shutter to move from 0 to 100
    protected _duration: number;
    
    // Is the cover blocked/jammed?
    protected _jammed: boolean = false;
    
    // This is a marker if we are moving the shutter ourselves. If not, it might have been
    // controlled by a local switch and we will not interfere with that manual control
    protected isMonitoring: boolean = false;

    protected _positionHeld: number = 0;

    protected _reverse: boolean = false;

    // last known position of the blinds, down by default
    protected _lastPosition: number = 0; 
    
    // down by default
    protected _currentTargetPosition: number = 0; 
    
    // Stopped by default
    protected _currentPositionState: number = 0;

    protected positionState: number = 0;

    protected _lastStatusTimestamp: number = performance.now()

    // Needed to avooid duplicate log outputs if nothing changes
    protected _lastInfo: string = '';

    constructor(hap: HAP, log: Logging, config: EleroMotorConfig, uuid: string, stick: EleroStick, channel: number) {
        super(hap, log, config, uuid, stick, channel);

        this._duration = config.duration || 20000;
        this._currentPositionState = hap.Characteristic.PositionState.STOPPED;
        this._reverse = config.reverse || false;

        let service: Service = new hap.Service.WindowCovering(this.displayName);

        // the current position (0-100%)
        // https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js#L493
        service
            .getCharacteristic(hap.Characteristic.CurrentPosition)
            .on(this.hap.CharacteristicEventTypes.GET, this.getCurrentPosition.bind(this));

        // the position state
        // 0 = DECREASING; 1 = INCREASING; 2 = STOPPED;
        // https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js#L1138
        service
            .getCharacteristic(hap.Characteristic.PositionState)
            .on(this.hap.CharacteristicEventTypes.GET, this.getPositionState.bind(this));
            
        // the target position (0-100%)
        // https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js#L1564
        service
            .getCharacteristic(hap.Characteristic.TargetPosition)
            .on(this.hap.CharacteristicEventTypes.GET, this.getTargetPosition.bind(this))
            .on(this.hap.CharacteristicEventTypes.SET, this.setTargetPosition.bind(this));

        // Hold Position stopps the service
        // https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js#L855
        service
            .getCharacteristic(hap.Characteristic.HoldPosition)
            .on(this.hap.CharacteristicEventTypes.GET, this.getHoldPosition.bind(this))
            .on(this.hap.CharacteristicEventTypes.SET, this.setHoldPosition.bind(this));

        service
            .getCharacteristic(hap.Characteristic.ObstructionDetected)
            .on(this.hap.CharacteristicEventTypes.GET, this.getObstructionDetected.bind(this));

        service
            .getCharacteristic(hap.Characteristic.Name)
            .on(this.hap.CharacteristicEventTypes.GET, this.getName.bind(this));

        this.windowCoveringService = service;

        log.info("Elero shutter accessory for channel '%s' created!", channel);
    }

    /**
     * This method is called directly after creation of this instance.
     * It should return all services which should be added to the accessory.
     */
    getServices(): Service[] {
        
        this.log.debug("Returning services");

        return [
            this.informationService,
            this.windowCoveringService,
        ];
    }

    /**
     * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
     * Typical this only ever happens at the pairing process.
     */
    identify(): void {
        this.log.info('Identify!');
    }

    protected getName(callback: CharacteristicGetCallback) {
        this.log.debug('[%d] Get Name: %s', this.channel, this.name);
        callback(null, this.name);
    }

    // Provide the outside position value depending on the reverse direction flag
    protected calculatePosition(value: number) : number {
        return ( this._reverse ? 100 - value : value);
    }

    get isJammed() { return this._jammed; }

    protected getObstructionDetected(callback: CharacteristicGetCallback) {
        this.log.debug('[%d][%s] Get ObstructionDetected: %s', this.channel, this.isJammed);
        callback(null, this.isJammed);
    }

    get holdPosition(): number { return this._positionHeld; }
    get currentPositionState() { return this._currentPositionState; }
    
    protected getPositionState(callback: CharacteristicGetCallback): void {
        var state = this.currentPositionState;

        if (this._reverse) {
            if (state == this.hap.Characteristic.PositionState.STOPPED) {
                // Nothing to do
            }
            else if (state == this.hap.Characteristic.PositionState.DECREASING) {
                state = this.hap.Characteristic.PositionState.INCREASING
            }
            else if (state == this.hap.Characteristic.PositionState.INCREASING) {
                state = this.hap.Characteristic.PositionState.DECREASING
            }
        }

        this.log.debug('[%d][%s] Requested PositionState: %s', this.channel, this.name, state);
        callback(null, state);
    }

    get lastPosition() { return this._lastPosition; }
    
    protected updateLastPosition(value: number): void {
        // TODO: Reflect reverse movement
        if (value >= 0 && value <= 100) {
            this._lastPosition = value;

            this.log.debug("[%d][%s] Updating lastPosition: %d", this.channel, this.name, this._lastPosition);
            this.windowCoveringService
                .getCharacteristic(this.hap.Characteristic.CurrentPosition)
                .updateValue(this.calculatePosition(this._lastPosition));
        }
        else {
            this.log.error("[%d][%s] Updating lastPosition with illegal value: %d: ", this.channel, this.name, value);
        }
    }
    
    get currentTargetPosition() { return this._currentTargetPosition; }

    protected updateTargetPosition(value: number): void {
        if (value >= 0 && value <= 100) {
            this._currentTargetPosition = value;

            this.log.debug("[%d] Updating currentTargetPosition: %d", this.channel, this._currentTargetPosition)
            this.windowCoveringService
                .getCharacteristic(this.hap.Characteristic.TargetPosition)
                .updateValue(this.calculatePosition(this._currentTargetPosition));
        }
        else {
            this.log.error("[%d][%s] Updating currentTargetPosition with illegal value: %d: ", this.channel, this.name, value);
        }
    }

    protected getTargetPosition(callback: CharacteristicGetCallback) {
        this.log.debug('[%d] Requested TargetPosition: %s', this.channel, this.currentTargetPosition);
        callback(null, this.calculatePosition(this.currentTargetPosition));
    }

    protected setTargetPosition(pos: CharacteristicValue, callback: CharacteristicSetCallback) {
        // TODO: Reflect reverse movement
        this.log.debug('[%d] Set TargetPosition: %d', this.channel, pos);
        this._currentTargetPosition = this.calculatePosition(pos as number);
        this._positionHeld = 0

        var moving = false;

        if ((pos < this._lastPosition) || (pos <= 10)) {
            this.stick.commandDown([this.channel]);
            moving = true;
        }
        // else if (pos <= 50) {
        //     this.stick.serialConnection.commandIntermediatePosition([this.channel])
        // }
        // else if (pos <= 75) {
        //     this.stick.serialConnection.commandVentilationPosition([this.channel])
        // }
        else if ((pos > this._lastPosition) || (pos >= 10)) {
            this.stick.commandUp([this.channel]);
            moving = true;
        }

        if (moving) {
            this.reportingInterval = 1500; // TODO: How to get these values here: movingUpdateInterval
            this.isMonitoring = true    
        }

        callback(null);
    }

    protected updatePositionState(value: number): void {
        this._currentPositionState = value

        this.log.debug("[%d] Updating currentPositionState: %d", this.channel, this._currentPositionState)
        this.windowCoveringService
            .getCharacteristic(this.hap.Characteristic.PositionState)
            .updateValue(this.calculatePosition(this._currentPositionState));
    }

    set lastPosition(value) {
        this._lastPosition = value;
        this.log.debug("[%d] Setting lastPosition: ", this.channel, this._lastPosition)
        this.windowCoveringService
            .getCharacteristic(this.hap.Characteristic.CurrentPosition)
            .setValue(this.calculatePosition(this._lastPosition));
    }

    set currentPositionState(value) {
        this._currentPositionState = value;
        this.log.debug("[%d] Setting currentPositionState: %d", this.channel, this._currentPositionState)
        this.windowCoveringService
            .getCharacteristic(this.hap.Characteristic.PositionState)
            .setValue(this._currentPositionState);
    }

    protected getCurrentPosition(callback:CharacteristicGetCallback) {
        this.log.debug('[%d] Requested CurrentPosition: %s', this.channel, this.lastPosition);
        callback(null, this.calculatePosition(this.lastPosition));
    }

    set currentTargetPosition(value) {
        this._currentTargetPosition = value;
        this.log.debug("[%d] Setting currentTargetPosition: ", this.channel, this._currentTargetPosition)
        this.windowCoveringService
            .getCharacteristic(this.hap.Characteristic.TargetPosition)
            .setValue(this.calculatePosition(this._currentTargetPosition));
    }

    set holdPosition(value) {
        this._positionHeld = value;
        this.windowCoveringService
            .getCharacteristic(this.hap.Characteristic.HoldPosition)
            .setValue(this._positionHeld);
    }

    protected getHoldPosition(callback: CharacteristicGetCallback) {
        this.log.debug('[%d] Requested HoldPosition: %s', this.channel, this._positionHeld);
        callback(null, this._positionHeld);
    }

    protected setHoldPosition(value: CharacteristicValue, callback: CharacteristicSetCallback) {
        this.log.debug('[%d] Set HoldPosition: ', this.channel, value);

        if (value == 1) {
            this.stick.commandStop([this.channel]);
        }

        this._positionHeld = (value as number);

        callback(null, this._positionHeld);
    }


    processState(state: number, currentTimestamp: number, defaultUpdateInterval: number, movingUpdateInterval: number): void {

        var newState = this.hap.Characteristic.PositionState.STOPPED
        var newPosition = this._lastPosition
        var newTargetPosition = this._currentTargetPosition

        var newInterval = this.reportingInterval || defaultUpdateInterval

        this._jammed = false

        if (this._currentPositionState != this.hap.Characteristic.PositionState.STOPPED) {
            // We are moving so figure out the elapsed time
            // and adjust the lastPosition accordingly.

            var direction = 1
            var check = (position: number, targetPosition: number) => { return (position >= targetPosition); }

            if (this._currentPositionState == this.hap.Characteristic.PositionState.DECREASING) {
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
                    // ourselves. For fully opened or closed, we will wait until TOP_POS 
                    // or BOTTOM_POS is reported.
                    if ((this._currentTargetPosition > 0) && (this._currentTargetPosition < 100)) {
                        if (check(newPosition, this._currentTargetPosition)) {
                            this.stick.commandStop([this.channel])
                        }    
                    }
                }

                this._lastStatusTimestamp = currentTimestamp
            }
        }
        
        if (state == ELERO_STATES.BOTTOM_POS_STOP) {
            newState = this.hap.Characteristic.PositionState.STOPPED
            newPosition = 0
            newTargetPosition = 0
            newInterval = defaultUpdateInterval

            this.isMonitoring = false
        }
        else if (state == ELERO_STATES.TOP_POS_STOP) {
            newState = this.hap.Characteristic.PositionState.STOPPED
            newPosition = 100
            newTargetPosition = 100
            newInterval = defaultUpdateInterval

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
            newState = this.hap.Characteristic.PositionState.DECREASING
            newInterval = movingUpdateInterval
        }
        else if (state == ELERO_STATES.MOVING_UP) {
            newState = this.hap.Characteristic.PositionState.INCREASING
            newInterval = movingUpdateInterval
        }
        else if (state == ELERO_STATES.START_MOVE_DOWN) {
            newState = this.hap.Characteristic.PositionState.DECREASING
            newInterval = movingUpdateInterval
        }
        else if (state == ELERO_STATES.START_MOVE_UP) {
            newState = this.hap.Characteristic.PositionState.INCREASING
            newInterval = movingUpdateInterval
        }
        else if (state == ELERO_STATES.BLOCKING) {
            newState = this.hap.Characteristic.PositionState.STOPPED
            newInterval = defaultUpdateInterval

            this._jammed = true
            this.isMonitoring = false
        }
        else if (state == ELERO_STATES.OVERHEATED) {
            newState = this.hap.Characteristic.PositionState.STOPPED
            newInterval = defaultUpdateInterval
            
            this._jammed = true
            this.isMonitoring = false
        }
        else if (state == ELERO_STATES.STOP_UNDEFINED_POS) {
            newState = this.hap.Characteristic.PositionState.STOPPED
            newInterval = defaultUpdateInterval

            newTargetPosition = this.lastPosition

            this.isMonitoring = false
        }

        this._lastStatusTimestamp = currentTimestamp

        this.updateTargetPosition(newTargetPosition)
        this.updateLastPosition(newPosition)
        this.updatePositionState(newState)
        this.lastPosition = newPosition
        this.positionState = newState

        this.log.debug('Updating reportingInterval for channel %s to %s', this.channel, this.reportingInterval);

        this.reportingInterval = newInterval

        this.logInfo();
    }

    protected amendedPosition(position: number): number {
        return (this._reverse ? 100 - position : position);
    }

    protected logInfo() {

        var info = " STOPPED [";
        if (this.currentPositionState == this.hap.Characteristic.PositionState.DECREASING) {
            info = " CLOSING [";
        } 
        else if (this.currentPositionState == this.hap.Characteristic.PositionState.INCREASING) {
            info = " OPENING [";
        }

        if (this.isJammed) {
            info = " JAMMED [";
        }

        // We build the string first and only emit a log entry if that entry has changed
        info = "[" + this.channel + "] " + this.name + info + this._lastPosition + "]";

        if (info != this._lastInfo) {
            this.log.info(info);
            this._lastInfo = info;
        }
    }    
}

