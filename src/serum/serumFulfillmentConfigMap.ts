import { PublicKey } from '@solana/web3.js';
import { SerumV3FulfillmentConfigAccount } from '../types';
import { DainClient } from '../dainClient';

export class SerumFulfillmentConfigMap {
	dainClient: DainClient;
	map = new Map<number, SerumV3FulfillmentConfigAccount>();

	public constructor(dainClient: DainClient) {
		this.dainClient = dainClient;
	}

	public async add(
		marketIndex: number,
		serumMarketAddress: PublicKey
	): Promise<void> {
		const account = await this.dainClient.getSerumV3FulfillmentConfig(
			serumMarketAddress
		);
		this.map.set(marketIndex, account);
	}

	public get(marketIndex: number): SerumV3FulfillmentConfigAccount {
		return this.map.get(marketIndex);
	}
}
