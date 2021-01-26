import { EleroMotorConfig } from "./elero-motor-config"

export interface EleroPlatformConfig {

    name: string;

    port: string;

    updateInterval?: number;

    movingUpdateInterval?: number;

    debugSerial?: boolean;

    motors: { [key:number]:EleroMotorConfig; };
}