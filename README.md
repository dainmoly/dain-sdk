# DAIN-SDK: A TypeScript SDK

## Getting Started

### Step 1: Initialize the dainClient

> This example uses @solana/web3.js version 1.91.8

In order to interact with the dain SDK, we must first configure the dainClient object using the `DainClient` instance:

```javascript
import { Connection } from "@solana/web3.js";
import { DainClient } from "@dain/drift-sdk";

export const connection = new Connection(RPC_URL);
export const signer = Keypair.fromSecretKey(bs58.decode(ADMIN_KEYPAIR));
export const wallet = new NodeWallet(signer);

export const client = new DainClient({
  programID: DAIN_PROGRAM_ID,
  connection,
  wallet: adminWallet,
  accountSubscription: {
    type: "polling",
    accountLoader: bulkAccountLoader,
  },
});
```

- `connection` establishes a connection to a Solana cluster
- `wallet` creates an Anchor-compliant Node.js wallet from your [local Solana keypair](https://docs.solanalabs.com/cli/wallets/)
- `accountSubscription` type can be "polling", "websocket"
- `client` is a high-level SDK for interacting with the Dain protocol

### Step 2: Subscribe client

In order to interact with dain protocol, you need to subscribe client for fetch accounts:

```javascript
await client.subscribe();
```

### Step 3: Create an Account

Accounts on dain protocol are the entry point for interacting with the protocol, allowing users to deposit assets, take out loans, and manage their positions. Using the dain SDK, you can create an account with one line of code. With this ability, you can enable seamless user onboarding by creating dedicated accounts for each new user.

```javascript
const marginfiAccount = await client.createMarginfiAccount();
```

### Step 4: Make a Deposit

Once you’ve fetched the bank you want to interact with, you can make a deposit:

```javascript
await client.deposit(1, bank.address);
```

The `deposit` method on the marginfi account object allows you to make a deposit into the specified bank account using the bank's address as a parameter (second parameter). Note that the first parameter let’s you specify how much (in the denominated asset) you want to deposit into the bank.

### Step 5: Borrow/Withdraw From a spot market

After lending liquidity on marginfi, you’re account is eligible to act as a Borrower. You can borrow liquidity from marginfi banks using one line of code:

```javascript
await client.withdraw(1, bank.address);
```

That's all! For more details on the dain SDK and use cases, refer to the examples folder.
