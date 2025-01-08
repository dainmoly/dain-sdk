import { BASE_PRECISION, DainClient, decodeName, NodeWallet, OptionalOrderParams, OrderType, PositionDirection, QUOTE_PRECISION, shortenPubkey } from "dain-sdk";
import { BN } from "@coral-xyz/anchor";
import { input, number, select } from '@inquirer/prompts';

import { connection } from "..";
import { loadKeypair } from "../utils";
import { DAIN_PROGRAM_ID } from "../constants";


(async () => {
    // Place ask order into perpMarket
    const userIdx = await number({ message: 'Enter userIdx:' });
    const signer = loadKeypair(userIdx);
    console.log(`Wallet ${signer.publicKey.toBase58()} loaded`);

    const wallet = new NodeWallet(signer);
    const client = new DainClient({
        programId: DAIN_PROGRAM_ID,
        confirmOpts: {
            commitment: 'confirmed'
        }
    }, connection, wallet);
    await client.load();

    // Get user input
    const marketIndex = await number({ message: 'Enter marketIndex' });
    const market = await client.getSpotMarketAccount(marketIndex);
    console.log(`${decodeName(market.name)} (${shortenPubkey(market.mint.toBase58())}) loaded`);

    const amount = Number(await input({ message: "Enter order amount" }));
    const baseAssetAmount = new BN(amount * BASE_PRECISION.toNumber());

    const direction = await select({
        message: "Ask/Bid",
        choices: [
            {
                name: "ask",
                value: "ask",
            },
            {
                name: "bid",
                value: "bid",
            }
        ]
    })

    const orderType = await select({
        message: "Limit/Market",
        choices: [
            {
                name: "limit",
                value: "limit",
            },
            {
                name: "market",
                value: "market",
            }
        ]
    })
    let orderPrice = 0;
    if (orderType == "limit") {
        orderPrice = Number(await input({ message: "Enter order price:" }));
    }

    // Place bid order
    const orderParams: OptionalOrderParams = {
        marketIndex,
        baseAssetAmount,
        price: new BN(orderPrice * QUOTE_PRECISION.toNumber()),
        orderType: orderType == 'limit' ? OrderType.LIMIT : OrderType.MARKET,
        direction: direction == 'ask' ? PositionDirection.SHORT : PositionDirection.LONG,
    };

    const tx = await client.placeAndTakeSpotOrder(
        orderParams,
    );
    console.log(`Placed order:`, tx);
})()