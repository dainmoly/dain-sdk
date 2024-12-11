import { PublicKey } from '@solana/web3.js';
import { PhoenixV1FulfillmentConfigAccount } from '../types';
import { DainClient } from '../dainClient';

export class PhoenixFulfillmentConfigMap {
	dainClient: DainClient;
	map = new Map<number, PhoenixV1FulfillmentConfigAccount>();

	public constructor(dainClient: DainClient) {
		this.dainClient = dainClient;
	}

	public async add(
		marketIndex: number,
		phoenixMarketAddress: PublicKey
	): Promise<void> {
		const account = await this.dainClient.getPhoenixV1FulfillmentConfig(
			phoenixMarketAddress
		);
		this.map.set(marketIndex, account);
	}

	public get(marketIndex: number): PhoenixV1FulfillmentConfigAccount {
		return this.map.get(marketIndex);
	}
}
