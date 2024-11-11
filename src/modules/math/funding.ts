import BN from 'bn.js';
import { ZERO } from '../../constants/numericConstants';
import { PerpMarketAccount } from '../../types';

/**
 *
 * @param market
 * @returns Estimated fee pool size
 */
export function calculateFundingPool(market: PerpMarketAccount): BN {
	// todo
	const totalFeeLB = market.amm.totalExchangeFee.div(new BN(2));
	const feePool = BN.max(
		ZERO,
		market.amm.totalFeeMinusDistributions
			.sub(totalFeeLB)
			.mul(new BN(1))
			.div(new BN(3))
	);
	return feePool;
}
