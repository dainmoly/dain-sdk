import { Connection, PublicKey } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';

import { Drift } from '../idls/drift';
import { PrelaunchOracle, OraclePriceData, OracleClient } from '../types';

export class PrelaunchOracleClient implements OracleClient {
	private connection: Connection;
	private program: Program<Drift>;

	public constructor(connection: Connection, program: Program<Drift>) {
		this.connection = connection;
		this.program = program;
	}

	public async getOraclePriceData(
		pricePublicKey: PublicKey
	): Promise<OraclePriceData | undefined> {
		const accountInfo = await this.connection.getAccountInfo(pricePublicKey);
		if (accountInfo) {
			return this.getOraclePriceDataFromBuffer(accountInfo.data);
		}

		return undefined;
	}

	public getOraclePriceDataFromBuffer(buffer: Buffer): OraclePriceData {
		const prelaunchOracle =
			this.program.account.prelaunchOracle.coder.accounts.decodeUnchecked(
				'prelaunchOracle',
				buffer
			) as PrelaunchOracle;

		return {
			price: prelaunchOracle.price,
			slot: prelaunchOracle.ammLastUpdateSlot,
			confidence: prelaunchOracle.confidence,
			hasSufficientNumberOfDataPoints: true,
			maxPrice: prelaunchOracle.maxPrice,
		};
	}
}
