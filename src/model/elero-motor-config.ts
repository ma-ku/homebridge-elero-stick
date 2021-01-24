
export interface EleroMotorConfig {

    type: 'shutter'|'shades';

    channel: number;

    name: string;
    
    displayName?: string;
    
    duration?: number;

    reverse?: boolean;
}