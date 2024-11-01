import { Connection } from '@solana/web3.js';
import { BN, Program } from '@coral-xyz/anchor';

import { Drift } from '@/idls/drift';
import { OracleClient } from '@/oracles/types';
import { PythClient } from '@/oracles/pythClient';
import { QuoteAssetOracleClient } from '@/oracles/quoteAssetOracleClient';
import { PrelaunchOracleClient } from '@/oracles/prelaunchOracleClient';
import { SwitchboardClient } from '@/oracles/switchboardClient';
import { PythPullClient } from '@/oracles/pythPullClient';
import { SwitchboardOnDemandClient } from '@/oracles/switchboardOnDemandClient';
import { OracleSource } from '@/types';
import { isVariant } from '@/modules';

export function getOracleClient(
	oracleSource: OracleSource,
	connection: Connection,
	program: Program<Drift>
): OracleClient {
	if (isVariant(oracleSource, 'pyth')) {
		return new PythClient(connection);
	}

	if (isVariant(oracleSource, 'pythPull')) {
		return new PythPullClient(connection);
	}

	if (isVariant(oracleSource, 'pyth1K')) {
		return new PythClient(connection, new BN(1000));
	}

	if (isVariant(oracleSource, 'pyth1KPull')) {
		return new PythPullClient(connection, new BN(1000));
	}

	if (isVariant(oracleSource, 'pyth1M')) {
		return new PythClient(connection, new BN(1000000));
	}

	if (isVariant(oracleSource, 'pyth1MPull')) {
		return new PythPullClient(connection, new BN(1000000));
	}

	if (isVariant(oracleSource, 'pythStableCoin')) {
		return new PythClient(connection, undefined, true);
	}

	if (isVariant(oracleSource, 'pythStableCoinPull')) {
		return new PythPullClient(connection, undefined, true);
	}

	if (isVariant(oracleSource, 'switchboard')) {
		return new SwitchboardClient(connection);
	}

	if (isVariant(oracleSource, 'prelaunch')) {
		return new PrelaunchOracleClient(connection, program);
	}

	if (isVariant(oracleSource, 'quoteAsset')) {
		return new QuoteAssetOracleClient();
	}

	if (isVariant(oracleSource, 'switchboardOnDemand')) {
		return new SwitchboardOnDemandClient(connection);
	}

	throw new Error(`Unknown oracle source ${oracleSource}`);
}
