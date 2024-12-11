import { DLOB } from './DLOB';
import { DainClient } from '../dainClient';

export type DLOBSubscriptionConfig = {
	dainClient: DainClient;
	dlobSource: DLOBSource;
	slotSource: SlotSource;
	updateFrequency: number;
};

export interface DLOBSubscriberEvents {
	update: (dlob: DLOB) => void;
	error: (e: Error) => void;
}

export interface DLOBSource {
	getDLOB(slot: number): Promise<DLOB>;
}

export interface SlotSource {
	getSlot(): number;
}
