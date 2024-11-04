import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, BN, IdlAccounts, Program } from '@coral-xyz/anchor';

import { OracleClient, OraclePriceData } from '../types';
import { ONE, PRICE_PRECISION, QUOTE_PRECISION, TEN, DRIFT_ORACLE_RECEIVER_ID } from '../constants';
import { PythSolanaReceiver as PythSolanaReceiverProgram } from "../idls/pythSolanaReceiver";
import pythSolanaReceiverIdl from '../idls/pyth_solana_receiver.json';

export type PriceUpdateAccount = IdlAccounts<PythSolanaReceiverProgram>["priceUpdateV2"];

export class PythPullClient implements OracleClient {
	private connection: Connection;
	private multiple: BN;
	private stableCoin: boolean;
	readonly receiver: Program<PythSolanaReceiverProgram>;
	readonly decodeFunc: (name: string, data: Buffer) => PriceUpdateAccount;

	public constructor(
		connection: Connection,
		multiple = ONE,
		stableCoin = false
	) {
		this.connection = connection;
		this.multiple = multiple;
		this.stableCoin = stableCoin;
		const provider = new AnchorProvider(
			this.connection,
			//@ts-ignore
			new Wallet(new Keypair()),
			{
				commitment: connection.commitment,
			}
		);
		this.receiver = new Program<PythSolanaReceiverProgram>(
			pythSolanaReceiverIdl as PythSolanaReceiverProgram,
			DRIFT_ORACLE_RECEIVER_ID,
			provider
		);
		this.decodeFunc =
			this.receiver.account.priceUpdateV2.coder.accounts.decodeUnchecked.bind(
				this.receiver.account.priceUpdateV2.coder.accounts
			);
	}

	public async getOraclePriceData(
		pricePublicKey: PublicKey
	): Promise<OraclePriceData | undefined> {
		const accountInfo = await this.connection.getAccountInfo(pricePublicKey);
		if (accountInfo) {
			return this.getOraclePriceDataFromBuffer(accountInfo.data);
		}
	}

	public getOraclePriceDataFromBuffer(buffer: Buffer): OraclePriceData {
		const message = this.decodeFunc('priceUpdateV2', buffer);
		const priceData = message.priceMessage;
		const confidence = convertPythPrice(
			priceData.conf,
			priceData.exponent,
			this.multiple
		);
		let price = convertPythPrice(
			priceData.price,
			priceData.exponent,
			this.multiple
		);
		if (this.stableCoin) {
			price = getStableCoinPrice(price, confidence);
		}

		return {
			price,
			slot: message.postedSlot,
			confidence,
			twap: convertPythPrice(
				priceData.price,
				priceData.exponent,
				this.multiple
			),
			twapConfidence: convertPythPrice(
				priceData.price,
				priceData.exponent,
				this.multiple
			),
			hasSufficientNumberOfDataPoints: true,
		};
	}
}

export function convertPythPrice(
	price: BN,
	exponent: number,
	multiple: BN
): BN {
	exponent = Math.abs(exponent);
	const pythPrecision = TEN.pow(new BN(exponent).abs()).div(multiple);
	return price.mul(PRICE_PRECISION).div(pythPrecision);
}

const fiveBPS = new BN(500);
function getStableCoinPrice(price: BN, confidence: BN): BN {
	if (price.sub(QUOTE_PRECISION).abs().lt(BN.min(confidence, fiveBPS))) {
		return QUOTE_PRECISION;
	} else {
		return price;
	}
}
