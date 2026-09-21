import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Wallet } from "ethers";
import { privateKeyToAccount } from "viem/accounts";

import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  isAddress,
  encodeFunctionData,
  defineChain,
} from "viem";

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


dotenv.config({ path: path.resolve(__dirname, '.env') });
// 如果 src 下没读到，再尝试读项目根目录的
if (!process.env.PRIVATE_KEY) {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
}


const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
console.log("TOKEN_ADDRESS:"+TOKEN_ADDRESS)
if (!TOKEN_ADDRESS || !isAddress(TOKEN_ADDRESS)) {
  console.error("❌ TOKEN_ADDRESS 不正确");
  process.exit(1);
}

const RPC_URL = "http://127.0.0.1:8545";
if (!RPC_URL) {
  console.error("❌ 请先设置 SEPOLIA_RPC_URL");
  process.exit(1);
}
// const sepolia = defineChain({
//   id: 11155111,
//   name: "Sepolia",

//   nativeCurrency: {
//     name: "Sepolia Ether",
//     symbol: "ETH",
//     decimals: 18,
//   },

//   rpcUrls: {
//     default: {
//       http: [RPC_URL],
//     },
//   },
// });

const anvil = defineChain({
    id: 31337,
    name: "Anvil",
    nativeCurrency: {
        name: "Ether",
        symbol: "ETH",
        decimals: 18,
    },
    rpcUrls: {
        default: {
            http: ["http://127.0.0.1:8545"],
        },
    },
});

const erc20Abi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },

  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },

  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },

  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      {
        name: "account",
        type: "address",
      },
    ],
    outputs: [
      {
        type: "uint256",
      },
    ],
  },

  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "to",
        type: "address",
      },
      {
        name: "amount",
        type: "uint256",
      },
    ],
    outputs: [
      {
        type: "bool",
      },
    ],
  },
];

const publicClient = createPublicClient({
  chain: anvil,
  transport: http(RPC_URL),
});

async function showBalance(address) {
    console.log("\n🔍 查询余额...\n");

    // 查询 ETH 余额
    const ethBalance = await publicClient.getBalance({
        address: address,
    });

    console.log("ETH:", formatUnits(ethBalance, 18));

    // 查询 Token 基本信息
    // const symbol = await publicClient.readContract({
    //     address: TOKEN_ADDRESS,
    //     abi: erc20Abi,
    //     functionName: "symbol",
    // });

    // const decimals = await publicClient.readContract({
    //     address: TOKEN_ADDRESS,
    //     abi: erc20Abi,
    //     functionName: "decimals",
    // });

    // // 查询 ERC20 余额
    // const tokenBalance = await publicClient.readContract({
    //     address: TOKEN_ADDRESS,
    //     abi: erc20Abi,
    //     functionName: "balanceOf",
    //     args: [account.address],
    // });

    // console.log(`${symbol}:`, formatUnits(tokenBalance, decimals));
}

async function buildERC20Transaction(address,amountStr) {
    console.log("输入参数："+address,amountStr)
    // 获取 Token decimals
    const decimals = await publicClient.readContract({
        address: TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "decimals",
    });

    // 获取 Token symbol
    const symbol = await publicClient.readContract({
        address: TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "symbol",
    });

    // 将人类可读金额转换成最小单位
    let amount;

    try {
        amount = parseUnits(amountStr, decimals);
    } catch {
        console.error("❌ 无效的金额");
        return null;
    }

    // 获取 nonce
    const nonce = await publicClient.getTransactionCount({
        address: address.address,
    });

    // 获取当前 gas price
    const gasPrice = await publicClient.getGasPrice();

    // EIP-1559 参数
    const maxPriorityFeePerGas = 1_000_000_000n; // 1 Gwei
    const maxFeePerGas = gasPrice + maxPriorityFeePerGas;

    // 编码 ERC20 transfer(to, amount)
    const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: ["0x233a4C93bd1FD06Be794877C48061D9BacF2FcED", amount],
    });

    // 构建 EIP-1559 交易
    const tx = {
        type: "eip1559",
        chainId: 31337,
        nonce,
        to: TOKEN_ADDRESS,
        data,
        value: 0n,
        maxFeePerGas,
        maxPriorityFeePerGas,
        gas: 100000n,
    };

    console.log("\n==============================");
    console.log("📦 EIP-1559 ERC20 Transaction");
    console.log("==============================");

    console.log("from:", address);
    console.log("contract:", TOKEN_ADDRESS);
    console.log("receiver:", "0x233a4C93bd1FD06Be794877C48061D9BacF2FcED");
    console.log("amount:", amountStr, symbol);
    console.log("chainId:", tx.chainId);
    console.log("type:", tx.type);
    console.log("nonce:", tx.nonce);
    console.log("maxFeePerGas:", tx.maxFeePerGas.toString());
    console.log(
        "maxPriorityFeePerGas:",
        tx.maxPriorityFeePerGas.toString()
    );
    console.log("data:", tx.data);

    console.log("==============================\n");

    return tx;
}

async function signTransaction(account, tx) {
    console.log("\n✍️ 正在签名...");

    const walletClient = createWalletClient({
        account,
        chain: anvil,
        transport: http(RPC_URL),
    });

    const signedTx = await walletClient.signTransaction({
        ...tx,
        account,
    });

    console.log("\n==============================");
    console.log("✅ 交易签名成功");
    console.log("==============================");
    console.log("signedTx:", signedTx);
    console.log("==============================\n");

    return signedTx;
}


// ===============================
// 创建钱包
// ===============================
function createWallet() {

  const wallet = Wallet.createRandom();

  console.log("\n==============================");
  console.log("🎉 钱包创建成功");
  console.log("==============================");

  console.log("address:");
  console.log(wallet.address);

  console.log("\nprivateKey:");
  console.log(wallet.privateKey);

  console.log("\n⚠️ 请妥善保存 privateKey");
  console.log("==============================\n");

  return wallet;
}

async function main() {
    const rl = readline.createInterface({
    input,
    output
    });

    // const to = await rl.question('👉 请输入接收地址 (to): ');

    // console.log('你输入的地址是:', to);

    const amountStr = await rl.question('👉 请输入转账金额: ');

    console.log('你输入的金额是:', amountStr);

    rl.close();

    const wallet = Wallet.createRandom();

    console.log("生成钱包address:", wallet.address);
    console.log("生成钱包privateKey:", wallet.privateKey);

    showBalance("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");

    const account = privateKeyToAccount(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
);

    const tx = await buildERC20Transaction(account,amountStr);

    if (tx) {
        const signedTx = await signTransaction(account, tx);

        console.log("最终签名交易:");
        console.log(signedTx);

        const hash = await publicClient.sendRawTransaction({
            serializedTransaction: signedTx,
        });

        console.log("txHash:", hash);
    }
}

main();