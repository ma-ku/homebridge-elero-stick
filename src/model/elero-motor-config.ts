
export interface EleroMotorConfig {

    type: 'shutter'|'shades'|'lights'|'heating';

    channel: number;

    name: string;
    
    displayName?: string;
    
    duration?: number;

    reverse?: boolean;
}