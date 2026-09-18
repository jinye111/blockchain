import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import { createPublicClient, http, parseAbiItem } from "viem";
import { foundry } from "viem/chains";

// ===================== 配置区（请修改这里） =====================
const TOKEN_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const RPC_URL = "http://127.0.0.1:8545";

const dbConfig = {
  host: "127.0.0.1",
  user: "root",              // 你的 MySQL 用户名
  password: "root", // 你的 MySQL 密码
  database: "token_indexer", // 数据库名
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10,
};

const PORT = 3000;
// ==============================================================

const erc20Abi = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
];

// 创建 MySQL 连接池
const pool = mysql.createPool(dbConfig);

// 初始化表
async function initDB() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS transfers (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        tx_hash VARCHAR(66) NOT NULL,
        log_index INT NOT NULL,
        block_number BIGINT NOT NULL,
        from_address VARCHAR(42) NOT NULL,
        to_address VARCHAR(42) NOT NULL,
        value VARCHAR(78) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_tx_log (tx_hash, log_index),
        INDEX idx_from (from_address),
        INDEX idx_to (to_address)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("✅ MySQL 表初始化完成");
  } finally {
    conn.release();
  }
}

// 保存转账记录
async function saveTransfer({ txHash, logIndex, blockNumber, from, to, value }) {
  await pool.execute(
    `INSERT IGNORE INTO transfers 
     (tx_hash, log_index, block_number, from_address, to_address, value)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      txHash,
      logIndex,
      blockNumber,
      from.toLowerCase(),
      to.toLowerCase(),
      value.toString(),
    ]
  );
}

// 查询某个地址的转账记录
async function getTransfersByAddress(address) {
  const addr = address.toLowerCase();
  const [rows] = await pool.execute(
    `SELECT * FROM transfers 
     WHERE from_address = ? OR to_address = ?
     ORDER BY block_number DESC, log_index DESC`,
    [addr, addr]
  );
  return rows;
}

// 处理单条日志
async function handleLog(log) {
  if (!log.args || !log.transactionHash) return;

  const { from, to, value } = log.args;

  await saveTransfer({
    txHash: log.transactionHash,
    logIndex: Number(log.logIndex),
    blockNumber: Number(log.blockNumber),
    from,
    to,
    value,
  });

  console.log(
    `📝 记录转账: ${from.slice(0, 8)}... → ${to.slice(0, 8)}... | ${value.toString()}`
  );
}

// 启动索引器
async function startIndexer() {
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(RPC_URL),
  });

  console.log("🚀 开始索引 Token 转账事件...");
  console.log("Token:", TOKEN_ADDRESS);

  // 1. 同步历史事件
  const latestBlock = await publicClient.getBlockNumber();
  console.log(`当前区块高度: ${latestBlock}`);

  const logs = await publicClient.getLogs({
    address: TOKEN_ADDRESS,
    event: parseAbiItem(
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    ),
    fromBlock: 0n,
    toBlock: latestBlock,
  });

  console.log(`找到 ${logs.length} 条历史 Transfer 事件，开始写入数据库...`);
  for (const log of logs) {
    await handleLog(log);
  }

  // 2. 实时监听新事件
  publicClient.watchContractEvent({
    address: TOKEN_ADDRESS,
    abi: erc20Abi,
    eventName: "Transfer",
    onLogs: async (logs) => {
      for (const log of logs) {
        await handleLog(log);
      }
    },
  });

  console.log("✅ 实时监听已启动");
}

// 启动 HTTP 服务
async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // 获取某个地址的转账记录
  app.get("/transfers/:address", async (req, res) => {
    try {
      const { address } = req.params;

      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return res.status(400).json({ error: "无效的地址格式" });
      }

      const records = await getTransfersByAddress(address);

      res.json({
        address,
        count: records.length,
        transfers: records,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "服务器错误" });
    }
  });

  // 健康检查
  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.listen(PORT, () => {
    console.log(`🌐 REST API 已启动: http://localhost:${PORT}`);
    console.log(
      `示例: GET http://localhost:${PORT}/transfers/0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
    );
  });
}

// 主函数
async function main() {
  try {
    await initDB();
    await startIndexer();
    await startServer();
  } catch (err) {
    console.error("启动失败:", err);
    process.exit(1);
  }
}

main();