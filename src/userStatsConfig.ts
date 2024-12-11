import { DainClient } from './dainClient';
import { Commitment, PublicKey } from '@solana/web3.js';
import { BulkAccountLoader } from './accounts/bulkAccountLoader';
import { GrpcConfigs } from './accounts/types';

export type UserStatsConfig = {
	accountSubscription?: UserStatsSubscriptionConfig;
	dainClient: DainClient;
	userStatsAccountPublicKey: PublicKey;
};

export type UserStatsSubscriptionConfig =
	| {
			type: 'websocket';
			resubTimeoutMs?: number;
			logResubMessages?: boolean;
			commitment?: Commitment;
	  }
	| {
			type: 'polling';
			accountLoader: BulkAccountLoader;
	  }
	| {
			type: 'custom';
	  }
	| {
			type: 'grpc';
			resubTimeoutMs?: number;
			logResubMessages?: boolean;
			grpcConfigs: GrpcConfigs;
	  };
