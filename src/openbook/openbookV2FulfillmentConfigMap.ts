import { PublicKey } from '@solana/web3.js';
import { OpenbookV2FulfillmentConfigAccount } from '../types';
import { DainClient } from '../dainClient';

export class OpenbookV2FulfillmentConfigMap {
	dainClient: DainClient;
	map = new Map<number, OpenbookV2FulfillmentConfigAccount>();

	public constructor(dainClient: DainClient) {
		this.dainClient = dainClient;
	}

	public async add(
		marketIndex: number,
		openbookV2MarketAddress: PublicKey
	): Promise<void> {
		const account = await this.dainClient.getOpenbookV2FulfillmentConfig(
			openbookV2MarketAddress
		);

		this.map.set(marketIndex, account);
	}

	public get(
		marketIndex: number
	): OpenbookV2FulfillmentConfigAccount | undefined {
		return this.map.get(marketIndex);
	}
}
