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
import { EleroConfiguration } from "./elero-configuration";

export class EleroShutterAccessory extends EleroAccessory {

    protected readonly windowCoveringService: Service;

    // Time of the shutter to move from 0 to 100
    protected _duration: number;
    
    // Time before the shutter actually moves at full speed
    protected _startDelay: number = 0;

    // Is the cover blocked/jammed?
    protected _jammed: boolean = false;
    
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

    constructor(hap: HAP, log: Logging, platformConfig: EleroConfiguration, motorConfig: EleroMotorConfig, uuid: string, stick: EleroStick, channel: number) {
        super(hap, log, platformConfig, motorConfig, uuid, stick, channel);

        this._duration = motorConfig.duration || 20000;
        this._startDelay = motorConfig.startDelay || 0;
        this._currentPositionState = hap.Characteristic.PositionState.STOPPED;
        this._reverse = motorConfig.reverse || false;

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

        this.services.push(service);

        log.info("Elero shutter accessory for channel '%s' created!", channel);
    }

    /**
     * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
     * Typical this only ever happens at the pairing process.
     */
    identify(): void {

        let sequence: {(stick: EleroStick, channel: number): number;}[] = [
            (stick: EleroStick, channel: number): number => { stick.commandStop([channel]); return 250; },
            (stick: EleroStick, channel: number): number => { stick.commandUp([channel]);   return 1000; },
            (stick: EleroStick, channel: number): number => { stick.commandDown([channel]); return 1000; },
            (stick: EleroStick, channel: number): number => { stick.commandUp([channel]);   return 1000; },
            (stick: EleroStick, channel: number): number => { stick.commandDown([channel]); return 1000; },
            (stick: EleroStick, channel: number): number => { stick.commandStop([channel]); return 250; }
        ];
        
        this.log.info('Identify!');
        
        this.runCallback(sequence);
    }

    protected runCallback(sequence: {(stick: EleroStick, channel: number): number;}[]) {

        let callback = sequence.shift();

        if (callback) {
            let stick = this.stick;
            let channel = this.channel;
            let timeout = callback(stick, channel);

            setTimeout(() => { this.runCallback(sequence) }, timeout);
        }
    }

    protected getName(callback: CharacteristicGetCallback) {
        this.log.debug('[%d] Get Name: %s', this.channel, this.name);
        callback(null, this.name);
    }

    // Provide the outside position value depending on the reverse direction flag
    protected calculatePosition(value: number) : number {
        return ( this._reverse ? 100 - value : value);
    }

    // Provide the outside state info depending on the reverse direction flag
    protected calculateState(value: number) : number {
        if (this._reverse) {
            switch (value) {
                case this.hap.Characteristic.PositionState.DECREASING:
                    return this.hap.Characteristic.PositionState.INCREASING;
                    
                case this.hap.Characteristic.PositionState.INCREASING:
                    return this.hap.Characteristic.PositionState.DECREASING;
            }
        }

        return value;
    }
    
    get isJammed() { return this._jammed; }

    // HomeKit callback: GET ObstructionDetected
    protected async getObstructionDetected(callback: CharacteristicGetCallback) {
        this.log.debug('[%d][%s] Get ObstructionDetected: %s', this.channel, this.isJammed);
        callback(null, this.isJammed);
    }

    get holdPosition(): number { return this._positionHeld; }
    get currentPositionState() { return this._currentPositionState; }
    
    // HomeKit callback: GET PositionState
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

    get lastPosition() : number { 
        return this._lastPosition; 
    }
    
    protected updateLastPosition(value: number): void {
        if (value >= 0 && value <= 100) {
            this._lastPosition = value;

            let hkValue = this.calculatePosition(this._lastPosition);
            this.log.debug("[%d][%s] Updating lastPosition: %d", this.channel, this.name, hkValue);
            this.windowCoveringService
                .getCharacteristic(this.hap.Characteristic.CurrentPosition)
                .updateValue(hkValue);
        }
        else {
            this.log.error("[%d][%s] Updating lastPosition with illegal value: %d: ", this.channel, this.name, value);
        }
    }
    
    get currentTargetPosition() : number { 
        return this._currentTargetPosition; 
    }

    protected updateTargetPosition(value: number): void {
        if (value >= 0 && value <= 100) {
            this._currentTargetPosition = value;

            let hkValue = this.calculatePosition(this._currentTargetPosition);
            this.log.debug("[%d] Updating currentTargetPosition: %d", this.channel, hkValue);
            this.windowCoveringService
                .getCharacteristic(this.hap.Characteristic.TargetPosition)
                .updateValue(hkValue);
        }
        else {
            this.log.error("[%d][%s] Updating currentTargetPosition with illegal value: %d: ", this.channel, this.name, value);
        }
    }

    // HomeKit callback: GET TargetPosition
    protected async getTargetPosition(callback: CharacteristicGetCallback) {
        let hkValue = this.calculatePosition(this._currentTargetPosition);
        this.log.debug('[%d] Requested TargetPosition: %s', this.channel, hkValue);
        callback(null, hkValue);
    }

    // HomeKit callback: SET TargetPosition
    protected async setTargetPosition(pos: CharacteristicValue, callback: CharacteristicSetCallback) {

        this.log.debug('[%d] Set TargetPosition: %d', this.channel, pos);
        this._currentTargetPosition = this.calculatePosition(pos as number);
        this._positionHeld = 0;

        var moving = false;

        if ((this._currentTargetPosition < this._lastPosition) || (this._currentTargetPosition < 5)) {
            this.stick.commandDown([this.channel]);
            moving = true;
        }
        // else if (pos <= 50) {
        //     this.stick.serialConnection.commandIntermediatePosition([this.channel])
        // }
        // else if (pos <= 75) {
        //     this.stick.serialConnection.commandVentilationPosition([this.channel])
        // }
        else if ((this._currentTargetPosition > this._lastPosition) || (this._currentTargetPosition > 5)) {
            this.stick.commandUp([this.channel]);
            moving = true;
        }

        if (moving) {
            this.reportingInterval = this.platformConfig.movingUpdateInterval || 1500;
            this.isMonitoring = true;
        }

        callback(null);
    }

    protected updatePositionState(value: number): void {
        this._currentPositionState = value;

        let hkValue = this.calculateState(this._currentPositionState);
        this.log.debug("[%d] Updating currentPositionState: %d", this.channel, hkValue);
        this.windowCoveringService
            .getCharacteristic(this.hap.Characteristic.PositionState)
            .updateValue(hkValue);
    }

    set lastPosition(value: number) {
        this._lastPosition = value;

        let hkValue = this.calculatePosition(this._lastPosition);
        this.log.debug("[%d] Setting lastPosition: ", this.channel, hkValue);
        this.windowCoveringService
            .getCharacteristic(this.hap.Characteristic.CurrentPosition)
            .setValue(hkValue);
    }

    set currentPositionState(value) {
        this._currentPositionState = value;

        let hkValue = this.calculateState(this._currentPositionState);
        this.log.debug("[%d] Setting currentPositionState: %d", this.channel, hkValue);
        this.windowCoveringService
            .getCharacteristic(this.hap.Characteristic.PositionState)
            .setValue(hkValue);
    }

    // HomeKit callback: GET CurrentPosition
    protected async getCurrentPosition(callback:CharacteristicGetCallback) {
        let hkValue = this.calculatePosition(this.lastPosition);
        this.log.debug('[%d] Requested CurrentPosition: %s', this.channel, hkValue);
        callback(null, hkValue);
    }

    set currentTargetPosition(value) {
        this._currentTargetPosition = value;
        let hkValue = this.calculatePosition(this._currentTargetPosition);
        this.log.debug("[%d] Setting currentTargetPosition: ", this.channel, hkValue);
        this.windowCoveringService
            .getCharacteristic(this.hap.Characteristic.TargetPosition)
            .setValue(hkValue);
    }

    set holdPosition(value) {
        this._positionHeld = value;
        this.windowCoveringService
            .getCharacteristic(this.hap.Characteristic.HoldPosition)
            .setValue(this._positionHeld);
    }

    // HomeKit callback: GET HoldPosition
    protected async getHoldPosition(callback: CharacteristicGetCallback) {
        this.log.debug('[%d] Requested HoldPosition: %s', this.channel, this._positionHeld);
        callback(null, this._positionHeld);
    }

    // HomeKit callback: SET HoldPosition
    protected async setHoldPosition(value: CharacteristicValue, callback: CharacteristicSetCallback) {
        this.log.debug('[%d] Set HoldPosition: %d', this.channel, value);

        if (value == 1) {
            this.stick.commandStop([this.channel]);
        }

        this._positionHeld = (value as number);

        callback(null, this._positionHeld);
    }


    processState(state: number, currentTimestamp: number): void {

        var newState = this.hap.Characteristic.PositionState.STOPPED;
        var newPosition = this._lastPosition;
        var newTargetPosition = this._currentTargetPosition;

        var newInterval = this.reportingInterval || this.platformConfig.defaultUpdateInterval;

        this._jammed = false;
              
        var actualMotorState = this.hap.Characteristic.PositionState.STOPPED;

        switch (state) {
        case ELERO_STATES.MOVING_DOWN:
        case ELERO_STATES.START_MOVE_DOWN:
            actualMotorState = this.hap.Characteristic.PositionState.DECREASING;
            break;

        case ELERO_STATES.MOVING_UP:
        case ELERO_STATES.START_MOVE_UP:
            actualMotorState = this.hap.Characteristic.PositionState.INCREASING;
            break;
    
        default:
            actualMotorState = this.hap.Characteristic.PositionState.STOPPED;
        }

        if (actualMotorState != this.hap.Characteristic.PositionState.STOPPED) {
            // We are moving so figure out the elapsed time
            // and adjust the lastPosition accordingly.

            var direction = 1;
            var check = (position: number, targetPosition: number) => { return (position >= targetPosition); };

            if (actualMotorState == this.hap.Characteristic.PositionState.DECREASING) {
                direction = -1;
                check = (position, targetPosition) => { return (position <= targetPosition); };
            }

            if (!this.isMonitoring) {
                // We will not interrupt
                check = (position, targetPosition) => { return false; };
            }

            var elapsed = (currentTimestamp - this._lastStatusTimestamp);

            this.updatePositionState(actualMotorState);

            if (elapsed > 0) {

                if (this._duration > 0) {
                    var delta = Math.max(0, 100 * elapsed / this._duration);
                    var newPosition = Math.min(100, Math.max(0, this._lastPosition + direction * delta));
                    this.updateLastPosition(newPosition);

                    // If we are driving to an intermediate position, we need to stop 
                    // ourselves. For fully opened or closed, we will wait until TOP_POS 
                    // or BOTTOM_POS is reported.
                    if ((this._currentTargetPosition > 0) && (this._currentTargetPosition < 100)) {
                        let result = check(newPosition, this._currentTargetPosition);
                        this.log.debug('Checking channel %s every %s ms. Now at %d, moving to %d. Check result is %s', this.channel, this.reportingInterval, newPosition, this._currentTargetPosition, result);

                        if (result) {
                            this.stick.commandStop([this.channel]);
                        }    
                    }
                }

                this._lastStatusTimestamp = currentTimestamp;
            }
        }
        
        if (state == ELERO_STATES.BOTTOM_POS_STOP) {
            newState = this.hap.Characteristic.PositionState.STOPPED;
            newPosition = 0;
            newTargetPosition = 0;
            newInterval = this.platformConfig.defaultUpdateInterval;

            this.isMonitoring = false;
        }
        else if (state == ELERO_STATES.TOP_POS_STOP) {
            newState = this.hap.Characteristic.PositionState.STOPPED;
            newPosition = 100;
            newTargetPosition = 100;
            newInterval = this.platformConfig.defaultUpdateInterval;

            this.isMonitoring = false;
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
            newState = this.hap.Characteristic.PositionState.DECREASING;
            newInterval = this.platformConfig.movingUpdateInterval;
        }
        else if (state == ELERO_STATES.MOVING_UP) {
            newState = this.hap.Characteristic.PositionState.INCREASING;
            newInterval = this.platformConfig.movingUpdateInterval;
        }
        else if (state == ELERO_STATES.START_MOVE_DOWN) {
            newState = this.hap.Characteristic.PositionState.DECREASING;
            newInterval = this.platformConfig.movingUpdateInterval;
            this._lastStatusTimestamp = currentTimestamp + this._startDelay;
        }
        else if (state == ELERO_STATES.START_MOVE_UP) {
            newState = this.hap.Characteristic.PositionState.INCREASING;
            newInterval = this.platformConfig.movingUpdateInterval;
            this._lastStatusTimestamp = currentTimestamp + this._startDelay;
        }
        else if (state == ELERO_STATES.BLOCKING) {
            newState = this.hap.Characteristic.PositionState.STOPPED;
            newInterval = this.platformConfig.defaultUpdateInterval;

            this._jammed = true;
            this.isMonitoring = false;
        }
        else if (state == ELERO_STATES.OVERHEATED) {
            newState = this.hap.Characteristic.PositionState.STOPPED;
            newInterval = this.platformConfig.defaultUpdateInterval;
            
            this._jammed = true;
            this.isMonitoring = false;
        }
        else if (state == ELERO_STATES.STOP_UNDEFINED_POS) {
            newState = this.hap.Characteristic.PositionState.STOPPED;
            newInterval = this.platformConfig.defaultUpdateInterval;

            newTargetPosition = this.lastPosition;
            this.isMonitoring = false;
        }

        this._lastStatusTimestamp = currentTimestamp;

        this.updateTargetPosition(newTargetPosition);
        this.updateLastPosition(newPosition);
        this.updatePositionState(newState);
        this.lastPosition = newPosition;
        this.positionState = newState;

        this.log.debug('Updating reportingInterval for channel %s to %s', this.channel, this.reportingInterval);

        this.reportingInterval = newInterval

        this.logInfo();
    }

    protected logInfo() {

        var info = " STOPPED [";
        if (this.calculateState(this.currentPositionState) == this.hap.Characteristic.PositionState.DECREASING) {
            info = " CLOSING [";
        } 
        else if (this.calculateState(this.currentPositionState) == this.hap.Characteristic.PositionState.INCREASING) {
            info = " OPENING [";
        }

        if (this.isJammed) {
            info = " JAMMED [";
        }

        // We build the string first and only emit a log entry if that entry has changed
        info = "[" + this.channel + "] " + this.name + info + this.calculatePosition(this._lastPosition) + "]";

        if (info != this._lastInfo) {
            this.log.info(info);
            this._lastInfo = info;
        }
    }    
}

