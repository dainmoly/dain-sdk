import { AuctionSubscriberConfig, AuctionSubscriberEvents } from './types';
import { DainClient } from '../dainClient';
import { getUserFilter, getUserWithAuctionFilter } from '../memcmp';
import StrictEventEmitter from 'strict-event-emitter-types';
import { EventEmitter } from 'events';
import { UserAccount } from '../types';
import { ConfirmOptions, Context, PublicKey } from '@solana/web3.js';
import { WebSocketProgramAccountSubscriber } from '../accounts/webSocketProgramAccountSubscriber';
import { ResubOpts } from '../accounts/types';

export class AuctionSubscriber {
	private dainClient: DainClient;
	private opts: ConfirmOptions;
	private resubOpts?: ResubOpts;

	eventEmitter: StrictEventEmitter<EventEmitter, AuctionSubscriberEvents>;
	private subscriber: WebSocketProgramAccountSubscriber<UserAccount>;

	constructor({
		dainClient,
		opts,
		resubTimeoutMs,
		logResubMessages,
	}: AuctionSubscriberConfig) {
		this.dainClient = dainClient;
		this.opts = opts || this.dainClient.opts;
		this.eventEmitter = new EventEmitter();
		this.resubOpts = { resubTimeoutMs, logResubMessages };
	}

	public async subscribe() {
		if (!this.subscriber) {
			this.subscriber = new WebSocketProgramAccountSubscriber<UserAccount>(
				'AuctionSubscriber',
				'User',
				this.dainClient.program,
				this.dainClient.program.account.user.coder.accounts.decode.bind(
					this.dainClient.program.account.user.coder.accounts
				),
				{
					filters: [getUserFilter(), getUserWithAuctionFilter()],
					commitment: this.opts.commitment,
				},
				this.resubOpts
			);
		}

		await this.subscriber.subscribe(
			(accountId: PublicKey, data: UserAccount, context: Context) => {
				this.eventEmitter.emit(
					'onAccountUpdate',
					data,
					accountId,
					context.slot
				);
			}
		);
	}

	public async unsubscribe() {
		if (!this.subscriber) {
			return;
		}
		this.subscriber.unsubscribe();
	}
}
