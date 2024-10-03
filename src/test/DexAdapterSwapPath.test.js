// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    getContractAt,
    getContract,
    getNamedSigners,
    utils: { keccak256, toUtf8Bytes, parseEther, parseUnits },
  },
  deployments: { fixture },
} = require("hardhat");
const { addLiquidity, getAmountsOut, getEncodedPath, getAmountsIn } = require("./utils/dexOperations");
const { wadMul } = require("./utils/math");

process.env.TEST = true;

describe("DexAdapter swap by path", function () {
  let dexAdapter, dexRouter, DNS, deployer, trader;
  let testTokenA, testTokenB, testTokenC;
  let decimalsA;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader } = await getNamedSigners());
    dexAdapter = await getContract("DexAdapter");
    DNS = await getContract("PrimexDNS");

    await run("deploy:ERC20Mock", {
      name: "TestTokenC",
      symbol: "TTC",
      decimals: "18",
      initialAccounts: JSON.stringify([]),
      initialBalances: JSON.stringify([]),
    });
    testTokenC = await getContract("TestTokenC");
    testTokenA = await getContract("TestTokenA");
    testTokenB = await getContract("TestTokenB");
    decimalsA = await testTokenA.decimals();

    const registryAddress = await dexAdapter.registry();
    const registry = await getContractAt("PrimexRegistry", registryAddress);
    const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
    const txGrantRole = await registry.grantRole(VAULT_ACCESS_ROLE, deployer.address);
    await txGrantRole.wait();
    await testTokenA.mint(dexAdapter.address, parseUnits("100", decimalsA));
  });

  describe("Uniswap V2", function () {
    let dex, path;
    let snapshotId;

    before(async function () {
      dex = "uniswap";
      dexRouter = await DNS.getDexAddress(dex);

      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenC });
      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenB, tokenB: testTokenC });
    });

    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    afterEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });

    it("Should swapExactTokensForTokens by path", async function () {
      const amountIn = parseUnits("1", decimalsA);
      path = [testTokenA.address, testTokenB.address, testTokenC.address];
      const amountOut = await getAmountsOut(dex, amountIn, path);

      const swapExactTokensForTokensParams = {
        encodedPath: await getEncodedPath(path, dex),
        tokenIn: path[0],
        tokenOut: path[path.length - 1],
        amountIn: amountIn,
        amountOutMin: 0,
        to: trader.address,
        deadline: new Date().getTime() + 600,
        dexRouter: dexRouter,
      };
      const result = await dexAdapter.callStatic.swapExactTokensForTokens(swapExactTokensForTokensParams);
      expect(result[1]).to.be.equal(amountOut);
    });

    it("Should getAmountsOut by path", async function () {
      const amountIn = parseUnits("1", decimalsA);
      path = [testTokenA.address, testTokenB.address, testTokenC.address];
      const amountOut = await getAmountsOut(dex, amountIn, path);

      const amountOutParams = {
        encodedPath: await getEncodedPath(path, dex),
        amount: amountIn,
        dexRouter: dexRouter,
      };
      const result = await dexAdapter.callStatic.getAmountsOut(amountOutParams);
      expect(result[1]).to.be.equal(amountOut);
    });

    it("Should getAmountsIn by path", async function () {
      const amountOut = parseUnits("1", decimalsA);
      path = [testTokenA.address, testTokenB.address, testTokenC.address];
      const amountIn = await getAmountsIn(dex, amountOut, path);

      const amountInParams = {
        encodedPath: await getEncodedPath(path, dex),
        amount: amountOut,
        dexRouter: dexRouter,
      };
      const result = await dexAdapter.callStatic.getAmountsIn(amountInParams);
      expect(result[0]).to.be.equal(amountIn);
    });
  });

  describe("Uniswap V3", function () {
    let dex, path;
    let snapshotId;

    before(async function () {
      dex = "uniswapv3";
      dexRouter = await DNS.getDexAddress(dex);

      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenC });
      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenB, tokenB: testTokenC });
    });

    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    afterEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });

    it("Should swapExactTokensForTokens by path", async function () {
      const amountIn = parseUnits("1", decimalsA);
      path = [testTokenA.address, testTokenB.address, testTokenC.address];
      const fees = ["3000", "3000"];
      const amountOut = await getAmountsOut(dex, amountIn, path, fees);

      const swapExactTokensForTokensParams = {
        encodedPath: await getEncodedPath(path, dex, fees),
        tokenIn: path[0],
        tokenOut: path[path.length - 1],
        amountIn: amountIn,
        amountOutMin: 0,
        to: trader.address,
        deadline: new Date().getTime() + 600,
        dexRouter: dexRouter,
      };
      const result = await dexAdapter.callStatic.swapExactTokensForTokens(swapExactTokensForTokensParams);
      expect(result[1]).to.be.equal(amountOut);
    });

    it("Should getAmountsOut by path", async function () {
      const amountIn = parseUnits("1", decimalsA);
      path = [testTokenA.address, testTokenB.address, testTokenC.address];
      const fees = ["3000", "3000"];
      const amountOut = await getAmountsOut(dex, amountIn, path, fees);

      const amountOutParams = {
        encodedPath: await getEncodedPath(path, dex, fees),
        amount: amountIn,
        dexRouter: dexRouter,
      };
      const result = await dexAdapter.callStatic.getAmountsOut(amountOutParams);
      expect(result[1]).to.be.equal(amountOut);
    });

    it("Should getAmountsIn by path", async function () {
      const amountOut = parseUnits("1", decimalsA);
      path = [testTokenA.address, testTokenB.address, testTokenC.address];
      const fees = ["3000", "3000"];
      const amountIn = await getAmountsIn(dex, amountOut, path, fees);

      const amountInParams = {
        encodedPath: await getEncodedPath(path, dex, fees),
        amount: amountOut,
        dexRouter: dexRouter,
      };
      const result = await dexAdapter.callStatic.getAmountsIn(amountInParams);
      expect(result[0]).to.be.equal(amountIn);
    });
  });

  describe("Curve", function () {
    let dex, path, pools;
    let snapshotId;
    let testTokenAcurve, testTokenBcurve, testTokenXcurve;
    let decimalsAcurve, decimalsXcurve;

    before(async function () {
      dex = "curve";
      dexRouter = await DNS.getDexAddress(dex);

      // The curve pool needs tokens with non-standard decimals
      await run("deploy:ERC20Mock", {
        name: "testTokenA_curve",
        symbol: "TTA",
        decimals: "18",
        initialAccounts: JSON.stringify([deployer.address]),
        initialBalances: JSON.stringify([parseUnits("100000", 18).toString()]),
      });
      testTokenAcurve = await getContract("testTokenA_curve");
      decimalsAcurve = await testTokenAcurve.decimals();

      await run("deploy:ERC20Mock", {
        name: "testTokenB_curve",
        symbol: "TTB",
        decimals: "8",
        initialAccounts: JSON.stringify([deployer.address]),
        initialBalances: JSON.stringify([parseUnits("100000", 8).toString()]),
      });
      testTokenBcurve = await getContract("testTokenB_curve");

      await run("deploy:ERC20Mock", {
        name: "testTokenX_curve",
        symbol: "TTX",
        decimals: "6",
        initialAccounts: JSON.stringify([deployer.address]),
        initialBalances: JSON.stringify([parseUnits("100000", 6).toString()]),
      });
      testTokenXcurve = await getContract("testTokenX_curve");
      decimalsXcurve = await testTokenXcurve.decimals();

      const pool = await addLiquidity({
        dex: "curve",
        from: "deployer",
        assets: [
          { token: testTokenXcurve.address, amount: "102490" },
          { token: testTokenBcurve.address, amount: "3" },
          { token: testTokenAcurve.address, amount: "40" },
        ],
      });

      pools = [pool, pool];
      await testTokenAcurve.mint(dexAdapter.address, parseUnits("100", decimalsAcurve));
    });

    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    afterEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });

    it("Should swapExactTokensForTokens by path", async function () {
      const amountIn = parseUnits("0.1", decimalsAcurve);
      path = [testTokenAcurve.address, testTokenBcurve.address, testTokenXcurve.address];
      const amountOut = await getAmountsOut(dex, amountIn, path, pools);

      const swapExactTokensForTokensParams = {
        encodedPath: await getEncodedPath(path, dex, pools),
        tokenIn: path[0],
        tokenOut: path[path.length - 1],
        amountIn: amountIn,
        amountOutMin: 0,
        to: trader.address,
        deadline: new Date().getTime() + 600,
        dexRouter: dexRouter,
      };
      const result = await dexAdapter.callStatic.swapExactTokensForTokens(swapExactTokensForTokensParams);
      const slippage = wadMul(amountOut.toString(), parseEther("0.01").toString()).toString();
      expect(result[1]).to.be.closeTo(amountOut, slippage);
    });

    it("Should getAmountsOut by path", async function () {
      const amountIn = parseUnits("1", decimalsAcurve);
      path = [testTokenAcurve.address, testTokenBcurve.address, testTokenXcurve.address];
      const amountOut = await getAmountsOut(dex, amountIn, path, pools);

      const amountOutParams = {
        encodedPath: await getEncodedPath(path, dex, pools),
        amount: amountIn,
        dexRouter: dexRouter,
      };
      const result = await dexAdapter.callStatic.getAmountsOut(amountOutParams);
      expect(result[1]).to.be.equal(amountOut);
    });

    it("Should getAmountsIn by path", async function () {
      const amountOut = parseUnits("1", decimalsXcurve);
      path = [testTokenAcurve.address, testTokenBcurve.address, testTokenXcurve.address];
      const amountIn = await getAmountsIn(dex, amountOut, path, pools);

      const amountInParams = {
        encodedPath: await getEncodedPath(path, dex, pools),
        amount: amountOut,
        dexRouter: dexRouter,
      };
      const result = await dexAdapter.callStatic.getAmountsIn(amountInParams);
      expect(result[0]).to.be.equal(amountIn);
    });
  });

  describe("Balancer", function () {
    let dex, path, pools;
    let snapshotId;

    before(async function () {
      dex = "balancer";
      dexRouter = await DNS.getDexAddress(dex);

      const poolBalancer1 = await addLiquidity({
        dex: dex,
        from: "lender",
        assets: [
          { token: testTokenA.address, weight: "5", amount: "10" },
          { token: testTokenB.address, weight: "5", amount: "10" },
        ],
      });
      const poolBalancer2 = await addLiquidity({
        dex: dex,
        from: "lender",
        assets: [
          { token: testTokenB.address, weight: "5", amount: "10" },
          { token: testTokenC.address, weight: "5", amount: "10" },
        ],
      });
      pools = [poolBalancer1, poolBalancer2];
      await testTokenA.mint(dexAdapter.address, parseUnits("100", decimalsA));
    });

    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    afterEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });

    it("Should swapExactTokensForTokens by path", async function () {
      const amountIn = parseUnits("1", decimalsA);
      path = [testTokenA.address, testTokenB.address, testTokenC.address];
      const amountOut = await getAmountsOut(dex, amountIn, path, pools);

      const swapExactTokensForTokensParams = {
        encodedPath: await getEncodedPath(path, dex, pools),
        tokenIn: path[0],
        tokenOut: path[path.length - 1],
        amountIn: amountIn,
        amountOutMin: 0,
        to: trader.address,
        deadline: new Date().getTime() + 600,
        dexRouter: dexRouter,
      };
      const result = await dexAdapter.callStatic.swapExactTokensForTokens(swapExactTokensForTokensParams);
      expect(result[1]).to.be.equal(amountOut);
    });

    it("Should getAmountsOut by path", async function () {
      const amountIn = parseUnits("1", decimalsA);
      path = [testTokenA.address, testTokenB.address, testTokenC.address];
      const amountOut = await getAmountsOut(dex, amountIn, path, pools);

      const amountOutParams = {
        encodedPath: await getEncodedPath(path, dex, pools),
        amount: amountIn,
        dexRouter: dexRouter,
      };
      const result = await dexAdapter.callStatic.getAmountsOut(amountOutParams);
      expect(result[1]).to.be.equal(amountOut);
    });

    it("Should getAmountsIn by path", async function () {
      const amountOut = parseUnits("1", decimalsA);
      path = [testTokenA.address, testTokenB.address, testTokenC.address];
      const amountIn = await getAmountsIn(dex, amountOut, path, pools);

      const amountInParams = {
        encodedPath: await getEncodedPath(path, dex, pools),
        amount: amountOut,
        dexRouter: dexRouter,
      };
      const result = await dexAdapter.callStatic.getAmountsIn(amountInParams);
      expect(result[0]).to.be.equal(amountIn);
    });
  });

  describe("Meshswap", function () {
    let dex, path;
    let snapshotId;

    before(async function () {
      dex = "meshswap";
      dexRouter = await DNS.getDexAddress(dex);

      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenC });
      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenB, tokenB: testTokenC });
    });

    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    afterEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });

    it("Should swapExactTokensForTokens by path", async function () {
      const amountIn = parseUnits("1", decimalsA);
      path = [testTokenA.address, testTokenB.address, testTokenC.address];
      const amountOut = await getAmountsOut(dex, amountIn, path);

      const swapExactTokensForTokensParams = {
        encodedPath: await getEncodedPath(path, dex),
        tokenIn: path[0],
        tokenOut: path[path.length - 1],
        amountIn: amountIn,
        amountOutMin: 0,
        to: trader.address,
        deadline: new Date().getTime() + 600,
        dexRouter: dexRouter,
      };
      const result = await dexAdapter.callStatic.swapExactTokensForTokens(swapExactTokensForTokensParams);
      expect(result[1]).to.be.equal(amountOut);
    });

    it("Should getAmountsOut by path", async function () {
      const amountIn = parseUnits("1", decimalsA);
      path = [testTokenA.address, testTokenB.address, testTokenC.address];
      const amountOut = await getAmountsOut(dex, amountIn, path);

      const amountOutParams = {
        encodedPath: await getEncodedPath(path, dex),
        amount: amountIn,
        dexRouter: dexRouter,
      };
      const result = await dexAdapter.callStatic.getAmountsOut(amountOutParams);
      expect(result[1]).to.be.equal(amountOut);
    });

    it("Should getAmountsIn by path", async function () {
      const amountOut = parseUnits("1", decimalsA);
      path = [testTokenA.address, testTokenB.address, testTokenC.address];
      const amountIn = await getAmountsIn(dex, amountOut, path);

      const amountInParams = {
        encodedPath: await getEncodedPath(path, dex),
        amount: amountOut,
        dexRouter: dexRouter,
      };
      const result = await dexAdapter.callStatic.getAmountsIn(amountInParams);
      expect(result[0]).to.be.equal(amountIn);
    });
  });

  describe("Quickswap V3", function () {
    let dex, path;
    let snapshotId;

    before(async function () {
      dex = "quickswapv3";
      dexRouter = await DNS.getDexAddress(dex);

      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenC });
      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenB, tokenB: testTokenC });
    });

    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    afterEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });

    it("Should swapExactTokensForTokens by path", async function () {
      const amountIn = parseUnits("1", decimalsA);
      path = [testTokenA.address, testTokenB.address, testTokenC.address];
      const amountOut = await getAmountsOut(dex, amountIn, path);

      const swapExactTokensForTokensParams = {
        encodedPath: await getEncodedPath(path, dex),
        tokenIn: path[0],
        tokenOut: path[path.length - 1],
        amountIn: amountIn,
        amountOutMin: 0,
        to: trader.address,
        deadline: new Date().getTime() + 600,
        dexRouter: dexRouter,
      };
      const result = await dexAdapter.callStatic.swapExactTokensForTokens(swapExactTokensForTokensParams);
      expect(result[1]).to.be.equal(amountOut);
    });

    it("Should getAmountsOut by path", async function () {
      const amountIn = parseUnits("1", decimalsA);
      path = [testTokenA.address, testTokenB.address, testTokenC.address];
      const amountOut = await getAmountsOut(dex, amountIn, path);

      const amountOutParams = {
        encodedPath: await getEncodedPath(path, dex),
        amount: amountIn,
        dexRouter: dexRouter,
      };
      const result = await dexAdapter.callStatic.getAmountsOut(amountOutParams);
      expect(result[1]).to.be.equal(amountOut);
    });

    it("Should getAmountsIn by path", async function () {
      const amountOut = parseUnits("1", decimalsA);
      path = [testTokenA.address, testTokenB.address, testTokenC.address];
      const amountIn = await getAmountsIn(dex, amountOut, path);

      const amountInParams = {
        encodedPath: await getEncodedPath(path, dex),
        amount: amountOut,
        dexRouter: dexRouter,
      };
      const result = await dexAdapter.callStatic.getAmountsIn(amountInParams);
      expect(result[0]).to.be.equal(amountIn);
    });
  });
});
