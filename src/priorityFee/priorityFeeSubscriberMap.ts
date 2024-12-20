import {
	DainMarketInfo,
	DriftPriorityFeeLevels,
	DriftPriorityFeeResponse,
	fetchDriftPriorityFee,
} from './driftPriorityFeeMethod';
import {
	DEFAULT_PRIORITY_FEE_MAP_FREQUENCY_MS,
	PriorityFeeSubscriberMapConfig,
} from './types';

/**
 * takes advantage of /batchPriorityFees endpoint from drift hosted priority fee service
 */
export class PriorityFeeSubscriberMap {
	frequencyMs: number;
	intervalId?: ReturnType<typeof setTimeout>;

	dainMarkets?: DainMarketInfo[];
	driftPriorityFeeEndpoint?: string;
	feesMap: Map<string, Map<number, DriftPriorityFeeLevels>>; // marketType -> marketIndex -> priority fee

	public constructor(config: PriorityFeeSubscriberMapConfig) {
		this.frequencyMs = config.frequencyMs;
		this.frequencyMs =
			config.frequencyMs ?? DEFAULT_PRIORITY_FEE_MAP_FREQUENCY_MS;
		this.driftPriorityFeeEndpoint = config.driftPriorityFeeEndpoint;
		this.dainMarkets = config.dainMarkets;
		this.feesMap = new Map<string, Map<number, DriftPriorityFeeLevels>>();
		this.feesMap.set('perp', new Map<number, DriftPriorityFeeLevels>());
		this.feesMap.set('spot', new Map<number, DriftPriorityFeeLevels>());
	}

	private updateFeesMap(driftPriorityFeeResponse: DriftPriorityFeeResponse) {
		driftPriorityFeeResponse.forEach((fee: DriftPriorityFeeLevels) => {
			this.feesMap.get(fee.marketType)!.set(fee.marketIndex, fee);
		});
	}

	public async subscribe(): Promise<void> {
		if (this.intervalId) {
			return;
		}

		await this.load();
		this.intervalId = setInterval(this.load.bind(this), this.frequencyMs);
	}

	public async unsubscribe(): Promise<void> {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = undefined;
		}
	}

	public async load(): Promise<void> {
		try {
			if (!this.dainMarkets) {
				return;
			}
			const fees = await fetchDriftPriorityFee(
				this.driftPriorityFeeEndpoint!,
				this.dainMarkets.map((m) => m.marketType),
				this.dainMarkets.map((m) => m.marketIndex)
			);
			this.updateFeesMap(fees);
		} catch (e) {
			console.error('Error fetching drift priority fees', e);
		}
	}

	public updateMarketTypeAndIndex(dainMarkets: DainMarketInfo[]) {
		this.dainMarkets = dainMarkets;
	}

	public getPriorityFees(
		marketType: string,
		marketIndex: number
	): DriftPriorityFeeLevels | undefined {
		return this.feesMap.get(marketType)?.get(marketIndex);
	}
}

/** Example usage:
async function main() {
    const dainMarkets: DainMarketInfo[] = [
        { marketType: 'perp', marketIndex: 0 },
        { marketType: 'perp', marketIndex: 1 },
        { marketType: 'spot', marketIndex: 2 }
    ];

    const subscriber = new PriorityFeeSubscriberMap({
        driftPriorityFeeEndpoint: 'https://dlob.drift.trade',
        frequencyMs: 5000,
        dainMarkets
    });
    await subscriber.subscribe();

    for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        dainMarkets.forEach(market => {
            const fees = subscriber.getPriorityFees(market.marketType, market.marketIndex);
            console.log(`Priority fees for ${market.marketType} market ${market.marketIndex}:`, fees);
        });
    }


    await subscriber.unsubscribe();
}

main().catch(console.error);
*/
