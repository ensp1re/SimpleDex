import { expect } from "chai";
import { ethers } from "hardhat";
import { SimpleDex, SimpleToken } from "../typechain-types";
import { BigNumberish, ethers as e } from "ethers";

describe("SimpleDex", () => {
  let SimpleDex: SimpleDex;
  let TokenA: SimpleToken;
  let TokenB: SimpleToken;
  let owner: e.Signer;
  let addr1: e.Signer;
  let addr2: e.Signer;
  const INITIAL_SUPPLY: BigNumberish = ethers.parseEther("1000000");

  beforeEach(async () => {
    [owner, addr1, addr2] = await ethers.getSigners();

    const SimpleTokenFactory = await ethers.getContractFactory("SimpleToken");
    TokenA = (await SimpleTokenFactory.deploy(
      "Token A",
      "TKA",
      INITIAL_SUPPLY
    )) as SimpleToken;
    TokenB = (await SimpleTokenFactory.deploy(
      "Token B",
      "TKB",
      INITIAL_SUPPLY
    )) as SimpleToken;

    const SimpleDexFactory = await ethers.getContractFactory("SimpleDex");
    SimpleDex = (await SimpleDexFactory.deploy()) as SimpleDex;

    await TokenA.approve(await SimpleDex.getAddress(), INITIAL_SUPPLY);
    await TokenB.approve(await SimpleDex.getAddress(), INITIAL_SUPPLY);
    await TokenA.connect(addr1).approve(
      await SimpleDex.getAddress(),
      INITIAL_SUPPLY
    );
    await TokenB.connect(addr1).approve(
      await SimpleDex.getAddress(),
      INITIAL_SUPPLY
    );

    await TokenA.transfer(await addr1.getAddress(), ethers.parseEther("10000"));
    await TokenB.transfer(await addr1.getAddress(), ethers.parseEther("10000"));
  });

  it("should deploy contracts", async () => {
    expect(await TokenA.getAddress()).to.not.equal(0);
    expect(await TokenB.getAddress()).to.not.equal(0);
    expect(await SimpleDex.getAddress()).to.not.equal(0);
  });

  describe("Liquidity", () => {
    it("Should add liquidity", async () => {
      const amountA = ethers.parseEther("1000");
      const amountB = ethers.parseEther("2000");

      const tx = await SimpleDex.addLiquidity(
        await TokenA.getAddress(),
        await TokenB.getAddress(),
        amountA,
        amountB
      );
      const receipt = await tx.wait();

      if (!receipt) {
        throw new Error("Transaction receipt is null");
      }
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const timestamp = block ? block.timestamp : 0;

      await expect(tx)
        .to.emit(SimpleDex, "LiquidityAdded")
        .withArgs(
          await TokenA.getAddress(),
          await TokenB.getAddress(),
          amountA,
          amountB,
          timestamp
        );

      const updatedPool = await SimpleDex.liquidityPools(
        await TokenA.getAddress(),
        await TokenB.getAddress()
      );
      expect(updatedPool.tokenAReserve).to.equal(amountA);
      expect(updatedPool.tokenBReserve).to.equal(amountB);
    });

    it("Should remove liquidity", async () => {
      const amountA = ethers.parseEther("1000");
      const amountB = ethers.parseEther("2000");

      await SimpleDex.addLiquidity(
        await TokenA.getAddress(),
        await TokenB.getAddress(),
        amountA,
        amountB
      );
      const liquidityMinted = await SimpleDex.liquidity(
        await TokenA.getAddress(),
        await TokenB.getAddress()
      );

      const tx = await SimpleDex.removeLiquidity(
        await TokenA.getAddress(),
        await TokenB.getAddress(),
        liquidityMinted
      );
      const receipt = await tx.wait();

      if (!receipt) {
        throw new Error("Transaction receipt is null");
      }

      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const timestamp = block ? block.timestamp : 0;

      await expect(tx)
        .to.emit(SimpleDex, "LiquidityRemoved")
        .withArgs(
          await TokenA.getAddress(),
          await TokenB.getAddress(),
          amountA,
          amountB,
          timestamp
        );

      const updatedPool = await SimpleDex.liquidityPools(
        await TokenA.getAddress(),
        await TokenB.getAddress()
      );
      expect(updatedPool.tokenAReserve).to.equal(0);
      expect(updatedPool.tokenBReserve).to.equal(0);
    });
  });

  describe("Swaps", () => {
    beforeEach(async () => {
      const amountA = ethers.parseEther("10000");
      const amountB = ethers.parseEther("20000");
      await SimpleDex.addLiquidity(
        await TokenA.getAddress(),
        await TokenB.getAddress(),
        amountA,
        amountB
      );
    });

    it("Should swap tokens successfully", async () => {
      const amountIn = ethers.parseEther("23");
      let reserveIn: bigint;
      let reserveOut: bigint;

      if ((await TokenA.getAddress()) < (await TokenB.getAddress())) {
        reserveIn = ethers.parseEther("10000");
        reserveOut = ethers.parseEther("20000");
      } else {
        reserveIn = ethers.parseEther("20000");
        reserveOut = ethers.parseEther("10000");
      }

      const amountInWithFee = amountIn * 997n;
      const numerator = amountInWithFee * reserveOut;
      const denominator = reserveIn * 1000n + amountInWithFee;
      const expectedAmountOut = numerator / denominator;

      await TokenA.transfer(await addr1.getAddress(), amountIn);
      await TokenA.connect(addr1).approve(
        await SimpleDex.getAddress(),
        amountIn
      );

      await expect(
        SimpleDex.connect(addr1).swapTokens(
          await TokenA.getAddress(),
          await TokenB.getAddress(),
          amountIn
        )
      )
        .to.emit(SimpleDex, "TradeExecuted")
        .withArgs(
          await addr1.getAddress(),
          await TokenA.getAddress(),
          await TokenB.getAddress(),
          amountIn,
          expectedAmountOut
        );

      // Verify user received the correct amount
      const userBalance = await TokenB.balanceOf(await addr1.getAddress());
      expect(userBalance).to.equal(expectedAmountOut);
    });

    it("Should fail if tokens are the same", async () => {
      const amountIn = ethers.parseEther("100");
      await expect(
        SimpleDex.connect(addr1).swapTokens(
          await TokenA.getAddress(),
          await TokenA.getAddress(),
          amountIn
        )
      ).to.be.revertedWith("Tokens must be different");
    });

    it("Should fail if amountIn is zero", async () => {
      await expect(
        SimpleDex.connect(addr1).swapTokens(
          await TokenA.getAddress(),
          await TokenB.getAddress(),
          0
        )
      ).to.be.revertedWith("Amount must be greater than 0");
    });
  });

  describe("Price", () => {
    it("Should calculate correct price", async () => {
      const amountA = ethers.parseEther("1000");
      const amountB = ethers.parseEther("2000");
      await SimpleDex.addLiquidity(
        await TokenA.getAddress(),
        await TokenB.getAddress(),
        amountA,
        amountB
      );

      const price = await SimpleDex.getPrice(
        await TokenA.getAddress(),
        await TokenB.getAddress()
      );
      expect(price).to.equal(ethers.parseEther("2"));
    });
  });

  describe("Trade History", () => {
    it("Should record trade history", async () => {
      const amountA = ethers.parseEther("1000");
      const amountB = ethers.parseEther("2000");
      await SimpleDex.addLiquidity(
        await TokenA.getAddress(),
        await TokenB.getAddress(),
        amountA,
        amountB
      );

      const amountIn = ethers.parseEther("10");
      await SimpleDex.connect(addr1).swapTokens(
        await TokenA.getAddress(),
        await TokenB.getAddress(),
        amountIn
      );

      const historyLength = await SimpleDex.getTradeHistoryCount(
        await addr1.getAddress()
      );
      expect(historyLength).to.equal(1);

      const trade = await SimpleDex.tradeHistory(await addr1.getAddress(), 0);
      expect(trade.trader).to.equal(await addr1.getAddress());
      expect(trade.tokenIn).to.equal(await TokenA.getAddress());
      expect(trade.tokenOut).to.equal(await TokenB.getAddress());
      expect(trade.amountIn).to.equal(amountIn);
    });
  });

  describe("Trade History with Filters", () => {
    beforeEach(async () => {
      const amountA = ethers.parseEther("10000");
      const amountB = ethers.parseEther("20000");
      await SimpleDex.addLiquidity(
        await TokenA.getAddress(),
        await TokenB.getAddress(),
        amountA,
        amountB
      );

      await SimpleDex.connect(addr1).swapTokens(
        await TokenA.getAddress(),
        await TokenB.getAddress(),
        ethers.parseEther("100")
      );
      await SimpleDex.connect(addr2).swapTokens(
        await TokenB.getAddress(),
        await TokenA.getAddress(),
        ethers.parseEther("200")
      );
      await SimpleDex.connect(addr1).swapTokens(
        await TokenA.getAddress(),
        await TokenB.getAddress(),
        ethers.parseEther("105")
      );
    });
  });
});
