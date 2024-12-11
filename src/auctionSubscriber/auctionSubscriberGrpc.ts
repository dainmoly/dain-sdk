import { AuctionSubscriberConfig, AuctionSubscriberEvents } from './types';
import { DainClient } from '../dainClient';
import { getUserFilter, getUserWithAuctionFilter } from '../memcmp';
import StrictEventEmitter from 'strict-event-emitter-types';
import { EventEmitter } from 'events';
import { UserAccount } from '../types';
import { ConfirmOptions, Context, PublicKey } from '@solana/web3.js';
import { WebSocketProgramAccountSubscriber } from '../accounts/webSocketProgramAccountSubscriber';
import { GrpcConfigs, ResubOpts } from '../accounts/types';
import { grpcProgramAccountSubscriber } from '../accounts/grpcProgramAccountSubscriber';

export class AuctionSubscriberGrpc {
	private dainClient: DainClient;
	private opts: ConfirmOptions;
	private resubOpts?: ResubOpts;
	private grpcConfigs?: GrpcConfigs;

	eventEmitter: StrictEventEmitter<EventEmitter, AuctionSubscriberEvents>;
	private subscriber: WebSocketProgramAccountSubscriber<UserAccount>;

	constructor({
		dainClient,
		opts,
		grpcConfigs,
		resubTimeoutMs,
		logResubMessages,
	}: AuctionSubscriberConfig) {
		this.dainClient = dainClient;
		this.opts = opts || this.dainClient.opts;
		this.eventEmitter = new EventEmitter();
		this.resubOpts = { resubTimeoutMs, logResubMessages };
		this.grpcConfigs = grpcConfigs;
	}

	public async subscribe() {
		if (!this.subscriber) {
			this.subscriber = new grpcProgramAccountSubscriber<UserAccount>(
				this.grpcConfigs,
				'AuctionSubscriber',
				'User',
				this.dainClient.program,
				this.dainClient.program.account.user.coder.accounts.decode.bind(
					this.dainClient.program.account.user.coder.accounts
				),
				{
					filters: [getUserFilter(), getUserWithAuctionFilter()],
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
