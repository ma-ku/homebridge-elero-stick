
export interface EleroMotorConfig {

    type: 'shutter'|'shades'|'lights'|'heating';

    channel: number;

    name: string;
    
    disabled?: boolean;

    displayName?: string;
    
    duration?: number;

    reverse?: boolean;

    startDelay?: number;
}