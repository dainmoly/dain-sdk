import { PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';

export function getSignerPublicKey(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(anchor.utils.bytes.utf8.encode('drift_signer'))],
    programId
  )[0];
}

export function getStateAccountPublicKeyAndNonce(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(anchor.utils.bytes.utf8.encode('drift_state'))],
    programId
  );
}

export function getStateAccountPublicKey(programId: PublicKey): PublicKey {
  return getStateAccountPublicKeyAndNonce(programId)[0];
}

export function getUserAccountPublicKeyAndNonce(
  programId: PublicKey,
  authority: PublicKey,
  subAccountId = 0
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode('user')),
      authority.toBuffer(),
      new anchor.BN(subAccountId).toArrayLike(Buffer, 'le', 2),
    ],
    programId
  );
}

export function getUserAccountPublicKey(
  programId: PublicKey,
  authority: PublicKey,
  subAccountId = 0
): PublicKey {
  return getUserAccountPublicKeyAndNonce(programId, authority, subAccountId)[0];
}

export function getUserStatsAccountPublicKey(
  programId: PublicKey,
  authority: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode('user_stats')),
      authority.toBuffer(),
    ],
    programId
  )[0];
}

export function getPerpMarketPublicKey(
  programId: PublicKey,
  marketIndex: number
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode('perp_market')),
      new anchor.BN(marketIndex).toArrayLike(Buffer, 'le', 2),
    ],
    programId
  )[0];
}

export function getSpotMarketPublicKey(
  programId: PublicKey,
  marketIndex: number
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode('spot_market')),
      new anchor.BN(marketIndex).toArrayLike(Buffer, 'le', 2),
    ],
    programId
  )[0];
}

export function getSpotMarketVaultPublicKey(
  programId: PublicKey,
  marketIndex: number
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode('spot_market_vault')),
      new anchor.BN(marketIndex).toArrayLike(Buffer, 'le', 2),
    ],
    programId
  )[0];
}

export function getInsuranceFundVaultPublicKey(
  programId: PublicKey,
  marketIndex: number
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode('insurance_fund_vault')),
      new anchor.BN(marketIndex).toArrayLike(Buffer, 'le', 2),
    ],
    programId
  )[0];
}

export function getInsuranceFundStakeAccountPublicKey(
  programId: PublicKey,
  authority: PublicKey,
  marketIndex: number
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode('insurance_fund_stake')),
      authority.toBuffer(),
      new anchor.BN(marketIndex).toArrayLike(Buffer, 'le', 2),
    ],
    programId
  )[0];
}

export function getSerumOpenOrdersPublicKey(
  programId: PublicKey,
  market: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode('serum_open_orders')),
      market.toBuffer(),
    ],
    programId
  )[0];
}

export function getSerumSignerPublicKey(
  programId: PublicKey,
  market: PublicKey,
  nonce: BN
): PublicKey {
  return anchor.web3.PublicKey.createProgramAddressSync(
    [market.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)],
    programId
  );
}

export function getSerumFulfillmentConfigPublicKey(
  programId: PublicKey,
  market: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode('serum_fulfillment_config')),
      market.toBuffer(),
    ],
    programId
  )[0];
}

export function getPhoenixFulfillmentConfigPublicKey(
  programId: PublicKey,
  market: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode('phoenix_fulfillment_config')),
      market.toBuffer(),
    ],
    programId
  )[0];
}

export function getOpenbookV2FulfillmentConfigPublicKey(
  programId: PublicKey,
  market: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(
        anchor.utils.bytes.utf8.encode('openbook_v2_fulfillment_config')
      ),
      market.toBuffer(),
    ],
    programId
  )[0];
}

export function getReferrerNamePublicKey(
  programId: PublicKey,
  nameBuffer: number[]
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode('referrer_name')),
      Buffer.from(nameBuffer),
    ],
    programId
  )[0];
}

export function getProtocolIfSharesTransferConfigPublicKey(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(anchor.utils.bytes.utf8.encode('if_shares_transfer_config'))],
    programId
  )[0];
}

export function getPrelaunchOraclePublicKey(
  programId: PublicKey,
  marketIndex: number
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode('prelaunch_oracle')),
      new anchor.BN(marketIndex).toArrayLike(Buffer, 'le', 2),
    ],
    programId
  )[0];
}

export function getPythPullOraclePublicKey(
  programId: PublicKey,
  feedId: Uint8Array
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode('pyth_pull')),
      Buffer.from(feedId),
    ],
    programId,
  )[0];
}
