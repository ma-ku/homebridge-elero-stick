import { EleroMotorConfig } from "./elero-motor-config"

export interface EleroPlatformConfig {

    name: string;

    port: string;

    updateInterval?: number;

    movingUpdateInterval?: number;

    debugSerial?: boolean;

    sendInterval?: number;

    motors: { [key:number]:EleroMotorConfig; };
}