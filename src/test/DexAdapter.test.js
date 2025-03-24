// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    provider,
    getContractAt,
    getContract,
    getNamedSigners,
    getContractFactory,
    constants: { AddressZero, HashZero, NegativeOne },
    utils: { keccak256, toUtf8Bytes, defaultAbiCoder, parseEther, parseUnits },
  },
  deployments: { fixture },
} = require("hardhat");
const {
  addLiquidity,
  getAmountsIn,
  getGas,
  getEncodedPath,
  getSinglePath,
  getPaths,
  getSingleRoute,
  getRoutes,
  getSingleMegaRoute,
  getMegaRoutes,
} = require("./utils/dexOperations");
const { wadMul } = require("./utils/math");
const { deployMockAccessControl, deployMockERC165, deployMockPrimexDNS } = require("./utils/waffleMocks");
const { getAdminSigners } = require("./utils/hardhatUtils");
const { ETH, NATIVE_CURRENCY } = require("./utils/constants");

process.env.TEST = true;

describe("DexAdapter", function () {
  let dexAdapter, DNS, PM, registry, deployer, caller, trader, MediumTimelockAdmin, ErrorsLibrary;
  let NonStandartERC20Token, nonStandartTokenDecimal, WETH;
  let mockRegistry, mockDNS, mockErc165;
  let snapshotId;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, caller, trader } = await getNamedSigners());
    ({ MediumTimelockAdmin } = await getAdminSigners());
    dexAdapter = await getContract("DexAdapter");
    WETH = await getContractAt("WETH9", await dexAdapter.WNative());
    DNS = await getContract("PrimexDNS");
    PM = await getContract("PositionManager");
    registry = await getContract("Registry");

    ErrorsLibrary = await getContract("Errors");

    await run("deploy:NonStandartERC20Mock", {
      name: "NonStandartERC20",
      decimals: "6",
      initialSupply: parseUnits("10000000", 6).toString(),
    });
    NonStandartERC20Token = await getContract("NonStandartERC20");
    nonStandartTokenDecimal = await NonStandartERC20Token.decimals();
  });

  beforeEach(async function () {
    mockRegistry = await deployMockAccessControl(deployer);
    mockDNS = await deployMockPrimexDNS(deployer);
    mockErc165 = await deployMockERC165(deployer);
    snapshotId = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });
  afterEach(async function () {
    await network.provider.request({
      method: "evm_revert",
      params: [snapshotId],
    });
  });

  it("Storage", async function () {
    expect(await dexAdapter.registry()).to.be.equal(registry.address);
  });

  describe("Constructor", function () {
    let dexAdapterFactory, registry, tokenApproveLibrary;

    before(async function () {
      const { deployer } = await getNamedSigners();
      registry = await getContract("Registry", deployer.address);
      tokenApproveLibrary = await getContract("TokenApproveLibrary");
      dexAdapterFactory = await getContractFactory("DexAdapter", {
        libraries: {
          TokenApproveLibrary: tokenApproveLibrary.address,
        },
      });
    });
    it("Should deploy dexAdapter and initialize", async function () {
      const dexAdapter = await dexAdapterFactory.deploy(registry.address, WETH.address);
      expect(await dexAdapter.initialize(DNS.address));
    });
    it("Should revert when a param 'address registry' is not supported", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      await expect(dexAdapterFactory.deploy(mockRegistry.address, WETH.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
    it("Should revert when the dns address is not supported", async function () {
      await mockDNS.mock.supportsInterface.returns(false);
      const dexAdapter = await dexAdapterFactory.deploy(registry.address, WETH.address);
      await expect(dexAdapter.initialize(mockDNS.address)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("Set function", function () {
    let snapshotId, dex, dexRouter;

    before(async function () {
      dex = process.env.DEX || "uniswap";
      dexRouter = await DNS.getDexAddress(dex);
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

    it("Should revert setDexType() when a param 'address _dexRouter' is zero", async function () {
      await expect(dexAdapter.setDexType(AddressZero, "1")).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setDexType", async function () {
      await expect(dexAdapter.connect(caller).setDexType(PM.address, "1")).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should setDexType", async function () {
      await dexAdapter.connect(MediumTimelockAdmin).setDexType(PM.address, "1");
      expect(await dexAdapter.dexType(PM.address)).to.equal(1);
    });

    it("Should emit DexTypeChanged when setDexType is successful", async function () {
      await expect(dexAdapter.connect(MediumTimelockAdmin).setDexType(PM.address, "1"))
        .to.emit(dexAdapter, "DexTypeChanged")
        .withArgs(PM.address, "1");
    });

    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setQuoter", async function () {
      await expect(dexAdapter.connect(caller).setQuoter(dexRouter, caller.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert setQuoter() when the dexType of the dexRouter is none", async function () {
      await expect(dexAdapter.setQuoter(caller.address, caller.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "DEX_ROUTER_NOT_SUPPORTED",
      );
    });
    it("Should revert setQuoter() when the quoter is zero", async function () {
      await expect(dexAdapter.setQuoter(dexRouter, AddressZero)).to.be.revertedWithCustomError(ErrorsLibrary, "QUOTER_NOT_SUPPORTED");
    });
    it("Should setQuoter() when the dexType of the dexRouter is not none and the quoter is not zero", async function () {
      await dexAdapter.connect(MediumTimelockAdmin).setQuoter(dexRouter, caller.address);
      expect(await dexAdapter.quoters(dexRouter)).to.be.equal(caller.address);
    });

    it("Should emit QuoterChanged when setQuoter is successful", async function () {
      await expect(dexAdapter.connect(MediumTimelockAdmin).setQuoter(dexRouter, caller.address))
        .to.emit(dexAdapter, "QuoterChanged")
        .withArgs(dexRouter, caller.address);
    });
  });

  describe("SwapExactTokensForTokens", function () {
    let testTokenA, testTokenB, dexRouter, swapExactTokensForTokensParams;
    let decimalsA, dex;

    before(async function () {
      const registryAddress = await dexAdapter.registry();
      const registry = await getContractAt("PrimexRegistry", registryAddress);
      const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
      const txGrantRole = await registry.grantRole(VAULT_ACCESS_ROLE, caller.address);
      await txGrantRole.wait();

      testTokenA = await getContract("TestTokenA");
      decimalsA = await testTokenA.decimals();
      testTokenB = await getContract("TestTokenB");

      dex = process.env.DEX || "uniswap";
      dexRouter = await DNS.getDexAddress(dex);

      await testTokenA.mint(dexAdapter.address, parseUnits("100", decimalsA));
      await testTokenB.mint(deployer.address, parseUnits("100", 18));

      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });

      await NonStandartERC20Token.transfer(dexAdapter.address, parseUnits("100", nonStandartTokenDecimal));
      await run("router:addLiquidity", {
        router: (await DNS.dexes(dex)).routerAddress,
        from: "deployer",
        to: "deployer",
        tokenA: NonStandartERC20Token.address,
        tokenB: testTokenB.address,
        amountADesired: "10",
        amountBDesired: "10",
      });
    });

    beforeEach(async function () {
      swapExactTokensForTokensParams = {
        encodedPath: getEncodedPath([testTokenA.address, testTokenB.address], dex),
        tokenIn: testTokenA.address,
        tokenOut: testTokenB.address,
        amountIn: parseUnits("1", decimalsA),
        amountOutMin: 0,
        to: trader.address,
        deadline: new Date().getTime() + 600,
        dexRouter: dexRouter,
      };
    });

    it("Should swapExactTokensForTokens", async function () {
      expect(await dexAdapter.connect(caller).swapExactTokensForTokens(swapExactTokensForTokensParams));
    });
    it("Should swapExactTokensForTokens with non standart erc20 token", async function () {
      swapExactTokensForTokensParams.encodedPath = await getEncodedPath([NonStandartERC20Token.address, testTokenB.address], dex);
      swapExactTokensForTokensParams.amountIn = parseUnits("1", nonStandartTokenDecimal);
      expect(await dexAdapter.connect(caller).swapExactTokensForTokens(swapExactTokensForTokensParams));
    });
    it("Should revert when deadline passed for _swapWithCurve", async function () {
      swapExactTokensForTokensParams.dexRouter = await DNS.getDexAddress("curve");
      swapExactTokensForTokensParams.deadline = (await provider.getBlock("latest")).timestamp - 10;

      await expect(dexAdapter.connect(caller).swapExactTokensForTokens(swapExactTokensForTokensParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SWAP_DEADLINE_PASSED",
      );
    });
    it("Should revert when passing an incorrect path for the balancer", async function () {
      swapExactTokensForTokensParams.dexRouter = await DNS.getDexAddress("balancer");
      swapExactTokensForTokensParams.encodedPath = defaultAbiCoder.encode(
        ["address[]", "bytes32[]", "int256[]"],
        [[testTokenA.address], [HashZero], [0]],
      );
      await expect(dexAdapter.connect(caller).swapExactTokensForTokens(swapExactTokensForTokensParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_PATH",
      );
    });

    it("Should revert swapExactTokensForTokens() when a param 'address _params.to' is zero", async function () {
      swapExactTokensForTokensParams.to = AddressZero;
      await expect(dexAdapter.connect(caller).swapExactTokensForTokens(swapExactTokensForTokensParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });

    it("Should revert swapExactTokensForTokens() when amount in is zero", async function () {
      swapExactTokensForTokensParams.amountIn = 0;
      await expect(dexAdapter.connect(caller).swapExactTokensForTokens(swapExactTokensForTokensParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ZERO_AMOUNT_IN",
      );
    });

    it("Should successfully swap tokens with arbitrary multicalls", async function () {
      const amountIn = parseUnits("1", decimalsA);
      const amountOutMin = 0;
      const path = [testTokenA.address, testTokenB.address];
      const to = trader.address;
      const deadline = new Date().getTime() + 600;

      const uniswapV2Router02 = await getContractAt("UniswapV2Router02", dexRouter);

      const approveCalldata = testTokenA.interface.encodeFunctionData("approve", [dexRouter, amountIn]);

      const swapCalldata = uniswapV2Router02.interface.encodeFunctionData("swapExactTokensForTokens", [
        amountIn,
        amountOutMin,
        path,
        to,
        deadline,
      ]);

      const calls = [
        { target: testTokenA.address, callData: approveCalldata, value: 0 },
        { target: dexRouter, callData: swapCalldata, value: 0 },
      ];
      const encodedPath = defaultAbiCoder.encode(["tuple(address target, bytes callData, uint256 value)[]"], [calls]);
      const swapExactTokensForTokensParams = {
        encodedPath: encodedPath,
        tokenIn: testTokenA.address,
        tokenOut: testTokenB.address,
        amountIn: amountIn,
        amountOutMin: amountOutMin,
        to: to,
        deadline: deadline,
        dexRouter: AddressZero,
      };
      expect(await dexAdapter.connect(caller).swapExactTokensForTokens(swapExactTokensForTokensParams));
    });

    it("Should revert if slippage tolerance is exceeded", async function () {
      const amountIn = parseEther("1");
      const amountOutMin = parseEther("2");

      const path = [testTokenA.address, testTokenB.address];
      const to = trader.address;
      const deadline = new Date().getTime() + 600;

      const uniswapV2Router02 = await getContractAt("UniswapV2Router02", dexRouter);

      const approveCalldata = testTokenA.interface.encodeFunctionData("approve", [dexRouter, amountIn]);

      const swapCalldata = uniswapV2Router02.interface.encodeFunctionData("swapExactTokensForTokens", [amountIn, 0, path, to, deadline]);

      const calls = [
        { target: testTokenA.address, callData: approveCalldata, value: 0 },
        { target: dexRouter, callData: swapCalldata, value: 0 },
      ];
      const encodedPath = defaultAbiCoder.encode(["tuple(address target, bytes callData)[]"], [calls]);

      const swapParams = {
        encodedPath: encodedPath,
        tokenIn: testTokenA.address,
        tokenOut: testTokenB.address,
        amountIn: amountIn,
        amountOutMin: amountOutMin,
        to: to,
        deadline: deadline,
        dexRouter: AddressZero,
      };

      await expect(dexAdapter.connect(caller).swapExactTokensForTokens(swapParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SLIPPAGE_TOLERANCE_EXCEEDED",
      );
    });
  });

  describe("GetAmountsOut", function () {
    let testTokenA, testTokenB, dexRouter, getAmountsOutParams;
    let dexAdapterFactory, registry, tokenApproveLibrary;
    let decimalsA, dex;

    before(async function () {
      const { deployer } = await getNamedSigners();
      registry = await getContract("Registry", deployer.address);
      tokenApproveLibrary = await getContract("TokenApproveLibrary");
      dexAdapterFactory = await getContractFactory("DexAdapter", {
        libraries: {
          TokenApproveLibrary: tokenApproveLibrary.address,
        },
      });

      const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
      const txGrantRole = await registry.grantRole(VAULT_ACCESS_ROLE, caller.address);
      await txGrantRole.wait();

      testTokenA = await getContract("TestTokenA");
      decimalsA = await testTokenA.decimals();
      testTokenB = await getContract("TestTokenB");

      dex = process.env.DEX || "uniswap";
      dexRouter = await DNS.getDexAddress(dex);
      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
    });

    beforeEach(async function () {
      getAmountsOutParams = {
        encodedPath: getEncodedPath([testTokenA.address, testTokenB.address], dex),
        amount: parseUnits("1", decimalsA),
        dexRouter: dexRouter,
      };
    });

    it("Should getAmountsOut", async function () {
      const amount = await dexAdapter.connect(caller).callStatic.getAmountsOut(getAmountsOutParams);
      expect(amount[0]).to.be.equal(parseUnits("1", decimalsA));
    });

    it("Should revert getAmountsOut() when a param 'address _params.dexRouter' is zero", async function () {
      getAmountsOutParams.dexRouter = AddressZero;
      await expect(dexAdapter.connect(caller).callStatic.getAmountsOut(getAmountsOutParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });

    it("Should revert getAmountsOut() when 0 amount in", async function () {
      getAmountsOutParams.amount = 0;
      await expect(dexAdapter.connect(caller).callStatic.getAmountsOut(getAmountsOutParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ZERO_AMOUNT",
      );
    });

    it("Should revert getAmountsOut() when unknown dex type", async function () {
      getAmountsOutParams.dexRouter = mockErc165.address;
      await expect(dexAdapter.connect(caller).callStatic.getAmountsOut(getAmountsOutParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "UNKNOWN_DEX_TYPE",
      );
    });

    it("Should revert getAmountsOut() when Uniswap v3 is added to the dexType but uniV3Quoter is not set", async function () {
      const dexAdapter = await dexAdapterFactory.deploy(registry.address, WETH.address);
      await dexAdapter.initialize(DNS.address);
      dexRouter = await DNS.getDexAddress("uniswapv3");
      getAmountsOutParams.dexRouter = dexRouter;
      await dexAdapter.setDexType(dexRouter, "2");
      await expect(dexAdapter.getAmountsOut(getAmountsOutParams)).to.be.revertedWithCustomError(ErrorsLibrary, "QUOTER_IS_NOT_PROVIDED");
    });
  });

  describe("getAmountIn", function () {
    let dexAdapterFactory, registry;
    let getAmountsInParams;
    let tokenPairs = []; // pairs on dexes uni, uni3, balancer, meshswap
    let tokenPairsCurve = []; // pairs on curve only
    const tokenPairsLength = 6;
    let dexes = []; // dexes uni, uni3, quickswapv3, balancer, , meshswap
    const amountToConvert = "20";
    let testTokenA, testTokenAcurve;
    let testTokenX;
    let testTokenC;
    let snapshotId;
    let decimalsA, decimalsAcurve, decimalsX, decimalsC;
    let pathParams;
    let tokenApproveLibrary;

    // eslint-disable-next-line mocha/no-hooks-for-single-case
    before(async function () {
      tokenApproveLibrary = await getContract("TokenApproveLibrary");
      dexAdapterFactory = await getContractFactory("DexAdapter", {
        libraries: {
          TokenApproveLibrary: tokenApproveLibrary.address,
        },
      });

      testTokenA = await getContract("TestTokenA");
      decimalsA = await testTokenA.decimals();

      // the ratio is close to the market
      // weights (for balancer) 3-3-4
      const liquidityAmount = {
        tokenA: "4000",
        tokenAcurve: "4000",
        tokenX: "300",
        tokenC: "10249000",
      };

      // The curve pool needs tokens with non-standard decimals
      await run("deploy:ERC20Mock", {
        name: "testTokenA_curve",
        symbol: "TTA",
        decimals: "18",
        initialAccounts: JSON.stringify([]),
        initialBalances: JSON.stringify([]),
      });

      testTokenAcurve = await getContract("testTokenA_curve");
      decimalsAcurve = await testTokenAcurve.decimals();

      await run("deploy:ERC20Mock", {
        name: "TestTokenX",
        symbol: "TTX",
        decimals: "8",
        initialAccounts: JSON.stringify([]),
        initialBalances: JSON.stringify([]),
      });
      testTokenX = await getContract("TestTokenX");
      decimalsX = await testTokenX.decimals();

      await run("deploy:ERC20Mock", {
        name: "TestTokenC",
        symbol: "TTC",
        decimals: "6",
        initialAccounts: JSON.stringify([]),
        initialBalances: JSON.stringify([]),
      });

      testTokenC = await getContract("TestTokenC");
      decimalsC = await testTokenC.decimals();

      const registryAddress = await dexAdapter.registry();
      registry = await getContractAt("PrimexRegistry", registryAddress);

      const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
      const txGrantRole = await registry.grantRole(VAULT_ACCESS_ROLE, trader.address);
      await txGrantRole.wait();

      // need for swaps
      await testTokenA.mint(dexAdapter.address, parseUnits("1000000", decimalsA));
      await testTokenAcurve.mint(dexAdapter.address, parseUnits("1000000", decimalsAcurve));
      await testTokenX.mint(dexAdapter.address, parseUnits("1000000", decimalsX));
      await testTokenC.mint(dexAdapter.address, parseUnits("1000000", decimalsC));

      tokenPairs = [
        [testTokenA, testTokenX],
        [testTokenC, testTokenA],
        [testTokenX, testTokenC],
        [testTokenX, testTokenA],
        [testTokenA, testTokenC],
        [testTokenC, testTokenX],
      ];
      expect(tokenPairs.length).to.be.equal(tokenPairsLength);

      tokenPairsCurve = [
        [testTokenAcurve, testTokenX],
        [testTokenC, testTokenAcurve],
        [testTokenX, testTokenC],
        [testTokenX, testTokenAcurve],
        [testTokenAcurve, testTokenC],
        [testTokenC, testTokenX],
      ];
      expect(tokenPairsCurve.length).to.be.equal(tokenPairsLength);

      dexes = ["uniswap", "uniswapv3", "balancer", "quickswapv3", "meshswap"]; //, "curve"];

      // add liquidity to uniswap
      await addLiquidity({
        dex: dexes[0],
        from: "lender",
        amountADesired: liquidityAmount.tokenA,
        amountBDesired: liquidityAmount.tokenX,
        tokenA: testTokenA,
        tokenB: testTokenX,
      });
      await addLiquidity({
        dex: dexes[0],
        from: "lender",
        amountADesired: liquidityAmount.tokenA,
        amountBDesired: liquidityAmount.tokenC,
        tokenA: testTokenA,
        tokenB: testTokenC,
      });
      await addLiquidity({
        dex: dexes[0],
        from: "lender",
        amountADesired: liquidityAmount.tokenX,
        amountBDesired: liquidityAmount.tokenC,
        tokenA: testTokenX,
        tokenB: testTokenC,
      });

      // add liquidity to uniswapv3
      await addLiquidity({
        dex: dexes[1],
        from: "lender",
        amountADesired: liquidityAmount.tokenA,
        amountBDesired: liquidityAmount.tokenX,
        tokenA: testTokenA,
        tokenB: testTokenX,
      });
      await addLiquidity({
        dex: dexes[1],
        from: "lender",
        amountADesired: liquidityAmount.tokenA,
        amountBDesired: liquidityAmount.tokenC,
        tokenA: testTokenA,
        tokenB: testTokenC,
      });
      await addLiquidity({
        dex: dexes[1],
        from: "lender",
        amountADesired: liquidityAmount.tokenX,
        amountBDesired: liquidityAmount.tokenC,
        tokenA: testTokenX,
        tokenB: testTokenC,
      });
      // add liquidity to quickswap v3
      await addLiquidity({
        dex: dexes[3],
        from: "lender",
        amountADesired: liquidityAmount.tokenA,
        amountBDesired: liquidityAmount.tokenX,
        tokenA: testTokenA,
        tokenB: testTokenX,
      });
      await addLiquidity({
        dex: dexes[3],
        from: "lender",
        amountADesired: liquidityAmount.tokenA,
        amountBDesired: liquidityAmount.tokenC,
        tokenA: testTokenA,
        tokenB: testTokenC,
      });
      await addLiquidity({
        dex: dexes[3],
        from: "lender",
        amountADesired: liquidityAmount.tokenX,
        amountBDesired: liquidityAmount.tokenC,
        tokenA: testTokenX,
        tokenB: testTokenC,
      });

      // add liquidity to balancer
      const poolBalancer = await addLiquidity({
        dex: dexes[2],
        from: "lender",
        assets: [
          { token: testTokenA.address, weight: "3", amount: liquidityAmount.tokenA },
          { token: testTokenX.address, weight: "3", amount: liquidityAmount.tokenX },
          { token: testTokenC.address, weight: "4", amount: liquidityAmount.tokenC },
        ],
      });

      // add liquidity to meshswap
      await addLiquidity({
        dex: dexes[4],
        from: "lender",
        amountADesired: liquidityAmount.tokenA,
        amountBDesired: liquidityAmount.tokenX,
        tokenA: testTokenA,
        tokenB: testTokenX,
      });
      await addLiquidity({
        dex: dexes[4],
        from: "lender",
        amountADesired: liquidityAmount.tokenA,
        amountBDesired: liquidityAmount.tokenC,
        tokenA: testTokenA,
        tokenB: testTokenC,
      });
      await addLiquidity({
        dex: dexes[4],
        from: "lender",
        amountADesired: liquidityAmount.tokenX,
        amountBDesired: liquidityAmount.tokenC,
        tokenA: testTokenX,
        tokenB: testTokenC,
      });
      // mint to meshswap router, its balance will be checked in 'sendTokenToExchange' function in RouterImpl contract
      const routerMeshswap = await getContract("MeshswapRouter");
      await testTokenC.mint(routerMeshswap.address, parseUnits("1000000", await testTokenC.decimals()));

      // add liquidity to curve
      const poolCurve = await addLiquidity({
        dex: "curve",
        from: "lender",
        assets: [
          { token: testTokenC.address, amount: liquidityAmount.tokenC },
          { token: testTokenX.address, amount: liquidityAmount.tokenX },
          { token: testTokenAcurve.address, amount: liquidityAmount.tokenAcurve },
        ],
      });

      pathParams = {
        uniswap: [],
        uniswapv3: ["3000"],
        balancer: [poolBalancer],
        curve: [poolCurve],
        quickswapv3: ["3000"],
        meshswap: [],
      };
    });

    beforeEach(async function () {
      getAmountsInParams = {
        encodedPath: getEncodedPath([testTokenA.address, testTokenX.address], "uniswap"),
        amount: parseUnits("1", decimalsX),
        dexRouter: await DNS.getDexAddress("uniswap"),
      };

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

    it("Should revert getAmountsIn() when a param 'address _params.dexRouter' is zero", async function () {
      getAmountsInParams.dexRouter = AddressZero;
      await expect(dexAdapter.connect(caller).callStatic.getAmountsIn(getAmountsInParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });

    it("Should revert getAmountsIn() when 0 amount in", async function () {
      getAmountsInParams.amount = 0;
      await expect(dexAdapter.connect(caller).callStatic.getAmountsIn(getAmountsInParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ZERO_AMOUNT",
      );
    });

    it("Should revert getAmountsIn() when Uniswap v3 is added to the dexType but uniV3Quoter is not set", async function () {
      const dexAdapter = await dexAdapterFactory.deploy(registry.address, WETH.address);
      await dexAdapter.initialize(DNS.address);
      const dexRouter = await DNS.getDexAddress("uniswapv3");
      getAmountsInParams.dexRouter = dexRouter;
      await dexAdapter.setDexType(dexRouter, "2");
      await expect(dexAdapter.getAmountsIn(getAmountsInParams)).to.be.revertedWithCustomError(ErrorsLibrary, "QUOTER_IS_NOT_PROVIDED");
    });

    for (let i = 0; i < tokenPairsLength; i++) {
      // eslint-disable-next-line mocha/no-setup-in-describe
      for (let j = 0; j < dexes.length; j++) {
        it("getAmountsIn", async function () {
          // naming configuration hack
          const input = ` ${await tokenPairs[i][0].name()} to ${await tokenPairs[i][1].name()} on ${dexes[j]}`;
          this._runnable.title = this._runnable.title + input;
          const dexRouter = await DNS.getDexAddress(dexes[j]);
          const expectedAmountOut = parseUnits(amountToConvert, await tokenPairs[i][1].decimals());

          const path = [tokenPairs[i][0].address, tokenPairs[i][1].address];
          if (dexes[j] === "uniswapv3") path.reverse(); //  uniswapv3 expects reverse order for getAmountsIn

          // get amountsIn from the dexOperation
          const amountIn = await getAmountsIn(dexes[j], expectedAmountOut, path, pathParams[dexes[j]]);

          // get amountsIn from the contract
          const [amountInFromContract] = await dexAdapter.callStatic.getAmountsIn({
            encodedPath: getEncodedPath(path, dexes[j], pathParams[dexes[j]]),
            amount: expectedAmountOut,
            dexRouter: dexRouter,
          });
          expect(amountInFromContract).to.be.equal(amountIn);

          // get amountsOut from the contract
          const [, amountOutFromContract] = await dexAdapter.callStatic.getAmountsOut({
            encodedPath: getEncodedPath([tokenPairs[i][0].address, tokenPairs[i][1].address], dexes[j], pathParams[dexes[j]]),
            amount: amountInFromContract,
            dexRouter: dexRouter,
          });

          const swapExactTokensForTokensParams = {
            encodedPath: getEncodedPath([tokenPairs[i][0].address, tokenPairs[i][1].address], dexes[j], pathParams[dexes[j]]),
            tokenIn: tokenPairs[i][0].address,
            tokenOut: tokenPairs[i][1].address,
            amountIn: amountInFromContract, // got from getAmountsIn
            amountOutMin: 0,
            to: trader.address,
            deadline: new Date().getTime() + 600,
            dexRouter: dexRouter,
          };

          // Do a token swap via the DexAdapter and check that the actual balance will be equal to the expectAmountOut
          const balanceBefore = await tokenPairs[i][1].balanceOf(trader.address);
          await dexAdapter.connect(trader).swapExactTokensForTokens(swapExactTokensForTokensParams);

          const balanceAfter = await tokenPairs[i][1].balanceOf(trader.address);
          const delta = balanceAfter.sub(balanceBefore);
          // The slippage is one ten thousandth percent
          const slippage = wadMul(expectedAmountOut.toString(), parseEther("0.0001").toString()).toString();
          expect(delta).to.be.equal(amountOutFromContract).to.be.closeTo(expectedAmountOut, slippage);
        });
      }
    }

    for (let i = 0; i < tokenPairsLength; i++) {
      it("getAmountsIn on curve", async function () {
        // naming configuration hack
        const input = ` ${await tokenPairsCurve[i][0].name()} to ${await tokenPairsCurve[i][1].name()}`;
        this._runnable.title = this._runnable.title + input;
        const dexRouter = await DNS.getDexAddress("curve");
        const expectedAmountOut = parseUnits(amountToConvert, await tokenPairsCurve[i][1].decimals());

        // get amountsIn from the dexOperation
        const amountIn = await getAmountsIn(
          "curve",
          expectedAmountOut,
          [tokenPairsCurve[i][0].address, tokenPairsCurve[i][1].address],
          pathParams.curve,
        );

        // get amountsIn from the contract
        const [amountInFromContract] = await dexAdapter.callStatic.getAmountsIn({
          encodedPath: getEncodedPath([tokenPairsCurve[i][0].address, tokenPairsCurve[i][1].address], "curve", pathParams.curve),
          amount: expectedAmountOut,
          dexRouter: dexRouter,
        });

        expect(amountInFromContract).to.be.equal(amountIn);

        // get amountsOut from the contract
        const [, amountOutFromContract] = await dexAdapter.callStatic.getAmountsOut({
          encodedPath: getEncodedPath([tokenPairsCurve[i][0].address, tokenPairsCurve[i][1].address], "curve", pathParams.curve),
          amount: amountInFromContract,
          dexRouter: dexRouter,
        });
        const swapExactTokensForTokensParams = {
          encodedPath: getEncodedPath([tokenPairsCurve[i][0].address, tokenPairsCurve[i][1].address], "curve", pathParams.curve),
          tokenIn: tokenPairsCurve[i][0].address,
          tokenOut: tokenPairsCurve[i][1].address,
          amountIn: amountInFromContract, // got from getAmountsIn
          amountOutMin: 0,
          to: trader.address,
          deadline: new Date().getTime() + 600,
          dexRouter: dexRouter,
        };

        // Do a token swap via the DexAdapter and check that the actual balance will be equal to the expectAmountOut
        const balanceBefore = await tokenPairsCurve[i][1].balanceOf(trader.address);
        await dexAdapter.connect(trader).swapExactTokensForTokens(swapExactTokensForTokensParams);

        const balanceAfter = await tokenPairsCurve[i][1].balanceOf(trader.address);
        const delta = balanceAfter.sub(balanceBefore);
        // The slippage is one ten thousandth percent
        const slippage = wadMul(expectedAmountOut.toString(), parseEther("0.0001").toString()).toString();
        expect(delta).to.be.equal(amountOutFromContract).to.be.closeTo(expectedAmountOut, slippage);
      });
    }
    describe("getAmountsInByPaths", function () {
      it("should getAmountsInByPaths through one dex", async function () {
        const amountOut = parseUnits("1", decimalsC);
        const singlePath = await getSinglePath([testTokenA.address, testTokenC.address], dexes[0]);

        const [amountIn] = await dexAdapter.callStatic.getAmountsIn({
          encodedPath: getEncodedPath([testTokenA.address, testTokenC.address], dexes[0]),
          amount: amountOut,
          dexRouter: await DNS.getDexAddress(dexes[0]),
        });
        const amountInByPath = await dexAdapter.callStatic.getAmountsInByPaths(amountOut, singlePath);

        expect(amountInByPath).to.be.equal(amountIn);
      });

      it("should getAmountsInByPaths through two dexes", async function () {
        const amountOut = parseUnits("1", decimalsC);
        const halfOfSwapAmount = amountOut.div("2");
        const doublePath = await getPaths([
          {
            dex: dexes[0],
            path: [testTokenA.address, testTokenC.address],
            shares: 1,
          },
          {
            dex: dexes[1],
            path: [testTokenA.address, testTokenC.address],
            shares: 1,
          },
        ]);

        const [amountImOnFirstDex] = await dexAdapter.callStatic.getAmountsIn({
          encodedPath: getEncodedPath([testTokenA.address, testTokenC.address], dexes[0]),
          amount: halfOfSwapAmount,
          dexRouter: await DNS.getDexAddress(dexes[0]),
        });
        const [amountInOnSecondDex] = await dexAdapter.callStatic.getAmountsIn({
          encodedPath: getEncodedPath([testTokenA.address, testTokenC.address], dexes[1]),
          amount: halfOfSwapAmount,
          dexRouter: await DNS.getDexAddress(dexes[1]),
        });
        const amountInByPath = await dexAdapter.callStatic.getAmountsInByPaths(amountOut, doublePath);

        expect(amountInByPath).to.be.equal(amountImOnFirstDex.add(amountInOnSecondDex));
      });
    });
    describe("getAmountsInByRoutes", function () {
      it("should getAmountsInByRoutes through one route with one dex", async function () {
        const amountOut = parseUnits("1", decimalsC);
        const singleRoute = await getSingleRoute([testTokenA.address, testTokenC.address], dexes[0]);
        const [amountIn] = await dexAdapter.callStatic.getAmountsIn({
          encodedPath: getEncodedPath([testTokenA.address, testTokenC.address], dexes[0]),
          amount: amountOut,
          dexRouter: await DNS.getDexAddress(dexes[0]),
        });
        const amountInByPathRoutes = await dexAdapter.callStatic.getAmountsInByRoutes(amountOut, singleRoute);
        expect(amountInByPathRoutes).to.be.equal(amountIn);
      });
      it("should getAmountsInByRoutes through two routes", async function () {
        const amountOut = parseUnits("1", decimalsC);
        const halfOfSwapAmount = amountOut.div("2");
        const doubleRoute = await getRoutes([
          {
            to: testTokenX.address,
            pathData: [
              {
                dex: dexes[0],
                path: [testTokenA.address, testTokenX.address],
                shares: 1,
              },
              {
                dex: dexes[1],
                path: [testTokenA.address, testTokenX.address],
                shares: 1,
              },
            ],
          },
          {
            to: testTokenC.address,
            pathData: [
              {
                dex: dexes[0],
                path: [testTokenX.address, testTokenC.address],
                shares: 1,
              },
              {
                dex: dexes[1],
                path: [testTokenX.address, testTokenC.address],
                shares: 1,
              },
            ],
          },
        ]);

        const [amountXOnFirstDex] = await dexAdapter.callStatic.getAmountsIn({
          encodedPath: getEncodedPath([testTokenX.address, testTokenC.address], dexes[0]),
          amount: halfOfSwapAmount,
          dexRouter: await DNS.getDexAddress(dexes[0]),
        });
        const [amountXOnSecondDex] = await dexAdapter.callStatic.getAmountsIn({
          encodedPath: getEncodedPath([testTokenX.address, testTokenC.address], dexes[1]),
          amount: halfOfSwapAmount,
          dexRouter: await DNS.getDexAddress(dexes[1]),
        });

        const amountInX = amountXOnFirstDex.add(amountXOnSecondDex);
        const halfOfSwapAmountX = amountInX.div("2");

        const [amountInAOnFirstDex] = await dexAdapter.callStatic.getAmountsIn({
          encodedPath: getEncodedPath([testTokenA.address, testTokenX.address], dexes[0]),
          amount: halfOfSwapAmountX,
          dexRouter: await DNS.getDexAddress(dexes[0]),
        });
        const [amountInAOnSecondDex] = await dexAdapter.callStatic.getAmountsIn({
          encodedPath: getEncodedPath([testTokenA.address, testTokenX.address], dexes[1]),
          amount: halfOfSwapAmountX,
          dexRouter: await DNS.getDexAddress(dexes[1]),
        });
        const amountInByPathRoutes = await dexAdapter.callStatic.getAmountsInByRoutes(amountOut, doubleRoute);
        expect(amountInByPathRoutes).to.be.equal(amountInAOnFirstDex.add(amountInAOnSecondDex));
      });
    });
    describe("getAmountInByMegaRoutes", function () {
      it("should getAmountInByMegaRoutes through signle megaroute", async function () {
        const amountOut = parseUnits("1", decimalsC);
        const singleMegaRoute = await getSingleMegaRoute([testTokenA.address, testTokenC.address], dexes[0]);
        const [amountIn] = await dexAdapter.callStatic.getAmountsIn({
          encodedPath: getEncodedPath([testTokenA.address, testTokenC.address], dexes[0]),
          amount: amountOut,
          dexRouter: await DNS.getDexAddress(dexes[0]),
        });
        const amountInByMegaRoutes = await dexAdapter.callStatic.getAmountInByMegaRoutes({
          tokenA: testTokenA.address,
          tokenB: testTokenC.address,
          amount: amountOut,
          megaRoutes: singleMegaRoute,
        });

        expect(amountInByMegaRoutes).to.be.equal(amountIn);
      });
      it("should getAmountInByMegaRoutes through double megaroute", async function () {
        const amountOut = parseUnits("1", decimalsC);
        const doubleMegaRoute = await getMegaRoutes([
          {
            shares: 1,
            // routes: => testTokenA => testTokenX => testTokenC
            routesData: [
              {
                to: testTokenX.address,
                pathData: [
                  {
                    dex: dexes[0],
                    path: [testTokenA.address, testTokenX.address],
                    shares: 1,
                  },
                  {
                    dex: dexes[1],
                    path: [testTokenA.address, testTokenX.address],
                    shares: 1,
                  },
                ],
              },
              {
                to: testTokenC.address,
                pathData: [
                  {
                    dex: dexes[0],
                    path: [testTokenX.address, testTokenC.address],
                    shares: 1,
                  },
                  {
                    dex: dexes[1],
                    path: [testTokenX.address, testTokenC.address],
                    shares: 1,
                  },
                ],
              },
            ],
          },
          {
            shares: 1,
            // routes: => testTokenA => testTokenX => testTokenC
            routesData: [
              {
                to: testTokenX.address,
                pathData: [
                  {
                    dex: dexes[0],
                    path: [testTokenA.address, testTokenX.address],
                    shares: 1,
                  },
                  {
                    dex: dexes[1],
                    path: [testTokenA.address, testTokenX.address],
                    shares: 1,
                  },
                ],
              },
              {
                to: testTokenC.address,
                pathData: [
                  {
                    dex: dexes[0],
                    path: [testTokenX.address, testTokenC.address],
                    shares: 1,
                  },
                  {
                    dex: dexes[1],
                    path: [testTokenX.address, testTokenC.address],
                    shares: 1,
                  },
                ],
              },
            ],
          },
        ]);

        const quarterOfAmountOut = amountOut.div("4");

        // calculate amount on first mega route
        const [amountInXOnFirstDexFirstRoute] = await dexAdapter.callStatic.getAmountsIn({
          encodedPath: getEncodedPath([testTokenX.address, testTokenC.address], dexes[0]),
          amount: quarterOfAmountOut,
          dexRouter: await DNS.getDexAddress(dexes[0]),
        });
        const [amountInXOnSecondDexFirstRoute] = await dexAdapter.callStatic.getAmountsIn({
          encodedPath: getEncodedPath([testTokenX.address, testTokenC.address], dexes[1]),
          amount: quarterOfAmountOut,
          dexRouter: await DNS.getDexAddress(dexes[1]),
        });

        const amountOutX = amountInXOnFirstDexFirstRoute.add(amountInXOnSecondDexFirstRoute);
        const halfOfAmountX = amountOutX.div("2");

        const [amountInAOnFirstDexFirstRoute] = await dexAdapter.callStatic.getAmountsIn({
          encodedPath: getEncodedPath([testTokenA.address, testTokenX.address], dexes[0]),
          amount: halfOfAmountX,
          dexRouter: await DNS.getDexAddress(dexes[0]),
        });
        const [amountInAOnSecondDexFirstRoute] = await dexAdapter.callStatic.getAmountsIn({
          encodedPath: getEncodedPath([testTokenA.address, testTokenX.address], dexes[1]),
          amount: halfOfAmountX,
          dexRouter: await DNS.getDexAddress(dexes[1]),
        });

        // calculate amount on second mega route
        const [amountInXOnFirstDexSecondRoute] = await dexAdapter.callStatic.getAmountsIn({
          encodedPath: getEncodedPath([testTokenX.address, testTokenC.address], dexes[0]),
          amount: quarterOfAmountOut,
          dexRouter: await DNS.getDexAddress(dexes[0]),
        });
        const [amountInXOnSecondtDexSecondRoute] = await dexAdapter.callStatic.getAmountsIn({
          encodedPath: getEncodedPath([testTokenX.address, testTokenC.address], dexes[1]),
          amount: quarterOfAmountOut,
          dexRouter: await DNS.getDexAddress(dexes[1]),
        });

        const amountInX = amountInXOnFirstDexSecondRoute.add(amountInXOnSecondtDexSecondRoute);
        const halfOfAmountInX = amountInX.div("2");

        const [amountInAOnFirstDexSecondRoute] = await dexAdapter.callStatic.getAmountsIn({
          encodedPath: getEncodedPath([testTokenA.address, testTokenX.address], dexes[0]),
          amount: halfOfAmountInX,
          dexRouter: await DNS.getDexAddress(dexes[0]),
        });
        const [amountInAOnSecondDexSecondRoute] = await dexAdapter.callStatic.getAmountsIn({
          encodedPath: getEncodedPath([testTokenA.address, testTokenX.address], dexes[1]),
          amount: halfOfAmountInX,
          dexRouter: await DNS.getDexAddress(dexes[1]),
        });
        const sumOfAToken = amountInAOnFirstDexFirstRoute
          .add(amountInAOnSecondDexFirstRoute)
          .add(amountInAOnFirstDexSecondRoute)
          .add(amountInAOnSecondDexSecondRoute);

        const getAmountInByMegaRoutes = await dexAdapter.callStatic.getAmountInByMegaRoutes({
          tokenA: testTokenA.address,
          tokenB: testTokenC.address,
          amount: amountOut,
          megaRoutes: doubleMegaRoute,
        });
        expect(getAmountInByMegaRoutes).to.be.equal(sumOfAToken);
      });
    });
  });

  describe("perform swaps", function () {
    let singlePath, singleRoute, doublePath, doubleRoute, singleMegaRoute, doubleMegaRoute;
    let dex, dex2, dex3;
    let testTokenA, testTokenB, testTokenC, testTokenX;
    let decimalsA;

    before(async function () {
      testTokenA = await getContract("TestTokenA");
      testTokenB = await getContract("TestTokenB");
      await run("deploy:ERC20Mock", {
        name: "TestTokenC",
        symbol: "TTC",
        decimals: "6",
        initialAccounts: JSON.stringify([]),
        initialBalances: JSON.stringify([]),
      });

      await run("deploy:ERC20Mock", {
        name: "TestTokenX",
        symbol: "TTX",
        decimals: "8",
        initialAccounts: JSON.stringify([]),
        initialBalances: JSON.stringify([]),
      });

      testTokenX = await getContract("TestTokenX");
      testTokenC = await getContract("TestTokenC");

      decimalsA = await testTokenA.decimals();
      dex = process.env.DEX || "uniswap";
      dex2 = "sushiswap";
      dex3 = "uniswapv3";

      singlePath = await getSinglePath([testTokenA.address, testTokenB.address], dex);
      singleRoute = await getSingleRoute([testTokenA.address, testTokenB.address], dex);
      singleMegaRoute = await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex);

      doublePath = await getPaths([
        {
          dex: dex,
          path: [testTokenA.address, testTokenB.address],
          shares: 1,
        },
        {
          dex: dex2,
          path: [testTokenA.address, testTokenB.address],
          shares: 1,
        },
      ]);

      doubleRoute = await getRoutes([
        {
          to: testTokenB.address,
          pathData: [
            {
              dex: dex,
              path: [testTokenA.address, testTokenB.address],
              shares: 1,
            },
            {
              dex: dex2,
              path: [testTokenA.address, testTokenB.address],
              shares: 1,
            },
          ],
        },
        {
          to: testTokenC.address,
          pathData: [
            {
              dex: dex,
              path: [testTokenB.address, testTokenC.address],
              shares: 1,
            },
            {
              dex: dex2,
              path: [testTokenB.address, testTokenC.address],
              shares: 1,
            },
          ],
        },
      ]);

      doubleMegaRoute = await getMegaRoutes([
        {
          shares: 1,
          // routes: => testTokenA => testTokenB => testTokenC
          routesData: [
            {
              to: testTokenB.address,
              pathData: [
                {
                  dex: dex,
                  path: [testTokenA.address, testTokenB.address],
                  shares: 1,
                },
                {
                  dex: dex2,
                  path: [testTokenA.address, testTokenB.address],
                  shares: 1,
                },
              ],
            },
            {
              to: testTokenC.address,
              pathData: [
                {
                  dex: dex,
                  path: [testTokenB.address, testTokenC.address],
                  shares: 1,
                },
                {
                  dex: dex2,
                  path: [testTokenB.address, testTokenC.address],
                  shares: 1,
                },
              ],
            },
          ],
        },
        {
          shares: 1,
          // routes: => testTokenA => testTokenX => testTokenC
          routesData: [
            {
              to: testTokenX.address,
              pathData: [
                {
                  dex: dex,
                  path: [testTokenA.address, testTokenX.address],
                  shares: 1,
                },
                {
                  dex: dex2,
                  path: [testTokenA.address, testTokenX.address],
                  shares: 1,
                },
              ],
            },
            {
              to: testTokenC.address,
              pathData: [
                {
                  dex: dex,
                  path: [testTokenX.address, testTokenC.address],
                  shares: 1,
                },
                {
                  dex: dex2,
                  path: [testTokenX.address, testTokenC.address],
                  shares: 1,
                },
              ],
            },
          ],
        },
      ]);

      const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
      await registry.grantRole(VAULT_ACCESS_ROLE, deployer.address);
      // testTokenA -- testTokenB
      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
      await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
      await addLiquidity({ dex: dex3, from: "lender", tokenA: testTokenA, tokenB: testTokenB });

      // testTokenA -- testTokenX
      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenX });
      await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenA, tokenB: testTokenX });
      await addLiquidity({ dex: dex3, from: "lender", tokenA: testTokenA, tokenB: testTokenX });

      // testTokenB -- testTokenC
      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenB, tokenB: testTokenC });
      await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenB, tokenB: testTokenC });
      await addLiquidity({ dex: dex3, from: "lender", tokenA: testTokenB, tokenB: testTokenC });

      // testTokenX -- testTokenC
      await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenX, tokenB: testTokenC });
      await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenX, tokenB: testTokenC });
      await addLiquidity({ dex: dex3, from: "lender", tokenA: testTokenX, tokenB: testTokenC });

      await testTokenA.mint(dexAdapter.address, parseUnits("1000000", decimalsA));
    });

    describe("performPathsSwap with the native currency", function () {
      let curvePool, balancerPool;
      before(async function () {
        // mint WETH and token
        await WETH.deposit({ value: parseEther("100") });
        await testTokenB.mint(deployer.address, parseUnits("100", await testTokenB.decimals()));

        // WETH -- testTokenB
        await addLiquidity({ dex: "uniswap", from: "deployer", tokenA: WETH, tokenB: testTokenB, needMint: false });
        await addLiquidity({ dex: "quickswapv3", from: "deployer", tokenA: WETH, tokenB: testTokenB, needMint: false });
        await addLiquidity({ dex: "uniswapv3", from: "deployer", tokenA: WETH, tokenB: testTokenB, needMint: false });

        balancerPool = await addLiquidity({
          dex: "balancer",
          from: "deployer",
          assets: [
            { token: WETH.address, weight: "3", amount: "10" },
            { token: testTokenB.address, weight: "3", amount: "10" },
            { token: testTokenA.address, weight: "4", amount: "10" },
          ],
        });

        // deploy and add liquidity to the ether pool
        const data = await run("curve:createEtherPool", {
          secondToken: testTokenB.address,
        });
        curvePool = data.pool;
        await testTokenB.mint(dexAdapter.address, parseUnits("10", await testTokenB.decimals()));
        await run("curve:addLiquidityEthPool", {
          from: "deployer",
          pool: curvePool,
          secondToken: testTokenB.address,
          amounts: JSON.stringify(["10", "10"]),
        });
      });
      it("should swap the native currency for a token on the Curve", async function () {
        const swapAmount = parseUnits("1", 18);
        const path = await getSinglePath([ETH, testTokenB.address], "curve", [curvePool]);
        const amountOut = await dexAdapter.callStatic.getAmountsOutByPaths(swapAmount, path);
        const balanceBefore = await testTokenB.balanceOf(deployer.address);
        await dexAdapter.performPathsSwap(NATIVE_CURRENCY, testTokenB.address, swapAmount, deployer.address, path, { value: swapAmount });
        const balanceAfter = await testTokenB.balanceOf(deployer.address);
        expect(balanceAfter.sub(balanceBefore)).to.be.equal(amountOut);
      });
      it("should swap a token for the native currency on the Curve", async function () {
        const swapAmount = parseUnits("1", await testTokenB.decimals());
        const path = await getSinglePath([testTokenB.address, ETH], "curve", [curvePool]);
        const amountOut = await dexAdapter.callStatic.getAmountsOutByPaths(swapAmount, path);
        await expect(() =>
          dexAdapter.performPathsSwap(testTokenB.address, NATIVE_CURRENCY, swapAmount, deployer.address, path),
        ).to.changeEtherBalances([curvePool, deployer.address], [amountOut.mul(NegativeOne), amountOut]);
      });
      it("should swap the native currency for a token on the Balancer", async function () {
        const swapAmount = parseUnits("1", 18);
        const path = await getSinglePath([WETH.address, testTokenB.address], "balancer", [balancerPool]);
        const amountOut = await dexAdapter.callStatic.getAmountsOutByPaths(swapAmount, path);
        const balanceBefore = await testTokenB.balanceOf(deployer.address);
        await dexAdapter.performPathsSwap(NATIVE_CURRENCY, testTokenB.address, swapAmount, deployer.address, path, { value: swapAmount });
        const balanceAfter = await testTokenB.balanceOf(deployer.address);
        expect(balanceAfter.sub(balanceBefore)).to.be.equal(amountOut);
      });
      it("should swap a token for the native currency on the Balancer", async function () {
        const swapAmount = parseUnits("1", await testTokenB.decimals());
        const path = await getSinglePath([testTokenB.address, WETH.address], "balancer", [balancerPool]);
        const amountOut = await dexAdapter.callStatic.getAmountsOutByPaths(swapAmount, path);
        const balanceBefore = await WETH.balanceOf(deployer.address);
        await dexAdapter.performPathsSwap(testTokenB.address, NATIVE_CURRENCY, swapAmount, deployer.address, path);
        const balanceAfter = await WETH.balanceOf(deployer.address);
        expect(balanceAfter.sub(balanceBefore)).to.be.equal(amountOut);
      });
      it("should swap the native currency for a token on the UniswapV3", async function () {
        const swapAmount = parseUnits("1", 18);
        const path = await getSinglePath([WETH.address, testTokenB.address], "uniswapv3");
        const amountOut = await dexAdapter.callStatic.getAmountsOutByPaths(swapAmount, path);
        const balanceBefore = await testTokenB.balanceOf(deployer.address);
        await dexAdapter.performPathsSwap(NATIVE_CURRENCY, testTokenB.address, swapAmount, deployer.address, path, { value: swapAmount });
        const balanceAfter = await testTokenB.balanceOf(deployer.address);
        expect(balanceAfter.sub(balanceBefore)).to.be.equal(amountOut);
      });
      it("should swap a token for the native currency on the UniswapV3", async function () {
        const swapAmount = parseUnits("1", await testTokenB.decimals());
        const path = await getSinglePath([testTokenB.address, WETH.address], "uniswapv3");
        const amountOut = await dexAdapter.callStatic.getAmountsOutByPaths(swapAmount, path);
        const balanceBefore = await WETH.balanceOf(deployer.address);
        await dexAdapter.performPathsSwap(testTokenB.address, NATIVE_CURRENCY, swapAmount, deployer.address, path);
        const balanceAfter = await WETH.balanceOf(deployer.address);
        expect(balanceAfter.sub(balanceBefore)).to.be.equal(amountOut);
      });
      it("should swap the native currency for a token on the QuickswapV3", async function () {
        const swapAmount = parseUnits("1", 18);
        const path = await getSinglePath([WETH.address, testTokenB.address], "quickswapv3");
        const amountOut = await dexAdapter.callStatic.getAmountsOutByPaths(swapAmount, path);
        const balanceBefore = await testTokenB.balanceOf(deployer.address);
        await dexAdapter.performPathsSwap(NATIVE_CURRENCY, testTokenB.address, swapAmount, deployer.address, path, { value: swapAmount });
        const balanceAfter = await testTokenB.balanceOf(deployer.address);
        expect(balanceAfter.sub(balanceBefore)).to.be.equal(amountOut);
      });
      it("should swap a token for the native currency on the QuickswapV3", async function () {
        const swapAmount = parseUnits("1", await testTokenB.decimals());
        const path = await getSinglePath([testTokenB.address, WETH.address], "quickswapv3");
        const amountOut = await dexAdapter.callStatic.getAmountsOutByPaths(swapAmount, path);
        const balanceBefore = await WETH.balanceOf(deployer.address);
        await dexAdapter.performPathsSwap(testTokenB.address, NATIVE_CURRENCY, swapAmount, deployer.address, path);
        const balanceAfter = await WETH.balanceOf(deployer.address);
        expect(balanceAfter.sub(balanceBefore)).to.be.equal(amountOut);
      });
      it("should swap the native currency for a token on the UniswapV2", async function () {
        const swapAmount = parseUnits("1", 18);
        const path = await getSinglePath([WETH.address, testTokenB.address], "uniswap");
        const amountOut = await dexAdapter.callStatic.getAmountsOutByPaths(swapAmount, path);
        const balanceBefore = await testTokenB.balanceOf(deployer.address);
        await dexAdapter.performPathsSwap(NATIVE_CURRENCY, testTokenB.address, swapAmount, deployer.address, path, { value: swapAmount });
        const balanceAfter = await testTokenB.balanceOf(deployer.address);
        expect(balanceAfter.sub(balanceBefore)).to.be.equal(amountOut);
      });
      it("should swap a token for the native currency on the UniswapV2", async function () {
        const swapAmount = parseUnits("1", await testTokenB.decimals());
        const path = await getSinglePath([testTokenB.address, WETH.address], "uniswap");
        const amountOut = await dexAdapter.callStatic.getAmountsOutByPaths(swapAmount, path);
        const balanceBefore = await WETH.balanceOf(deployer.address);
        await dexAdapter.performPathsSwap(testTokenB.address, NATIVE_CURRENCY, swapAmount, deployer.address, path);
        const balanceAfter = await WETH.balanceOf(deployer.address);
        expect(balanceAfter.sub(balanceBefore)).to.be.equal(amountOut);
      });
    });
    describe("performPathsSwap", function () {
      it("should performPathsSwap through one dex", async function () {
        const swapAmount = parseUnits("1", decimalsA);
        const [, amountOut] = await dexAdapter.callStatic.getAmountsOut({
          encodedPath: getEncodedPath([testTokenA.address, testTokenB.address], dex),
          amount: swapAmount,
          dexRouter: await DNS.getDexAddress(dex),
        });
        const balanceBefore = await testTokenB.balanceOf(deployer.address);
        await dexAdapter.performPathsSwap(testTokenA.address, testTokenB.address, swapAmount, deployer.address, singlePath);
        const balanceAfter = await testTokenB.balanceOf(deployer.address);

        expect(balanceAfter.sub(balanceBefore)).to.be.equal(amountOut);
      });

      it("should performPathsSwap through two dexes", async function () {
        const swapAmount = parseUnits("1", decimalsA);
        const halfOfSwapAmount = swapAmount.div("2");

        const [, amountOutOnFirstDex] = await dexAdapter.callStatic.getAmountsOut({
          encodedPath: getEncodedPath([testTokenA.address, testTokenB.address], dex),
          amount: halfOfSwapAmount,
          dexRouter: await DNS.getDexAddress(dex),
        });
        const [, amountOutOnSecondDex] = await dexAdapter.callStatic.getAmountsOut({
          encodedPath: getEncodedPath([testTokenA.address, testTokenB.address], dex2),
          amount: halfOfSwapAmount,
          dexRouter: await DNS.getDexAddress(dex2),
        });
        const balanceBefore = await testTokenB.balanceOf(deployer.address);
        await dexAdapter.performPathsSwap(testTokenA.address, testTokenB.address, swapAmount, deployer.address, doublePath);
        const balanceAfter = await testTokenB.balanceOf(deployer.address);

        expect(balanceAfter.sub(balanceBefore)).to.be.equal(amountOutOnFirstDex.add(amountOutOnSecondDex));
      });
    });
    describe("performRoutesSwap", function () {
      it("should performRoutesSwap through one route with one dex", async function () {
        const swapAmount = parseUnits("1", decimalsA);
        const [, amountOut] = await dexAdapter.callStatic.getAmountsOut({
          encodedPath: getEncodedPath([testTokenA.address, testTokenB.address], dex),
          amount: swapAmount,
          dexRouter: await DNS.getDexAddress(dex),
        });
        const returnAmount = await dexAdapter.callStatic.performRoutesSwap(testTokenA.address, swapAmount, deployer.address, singleRoute);
        const balanceBefore = await testTokenB.balanceOf(deployer.address);
        await dexAdapter.performRoutesSwap(testTokenA.address, swapAmount, deployer.address, singleRoute);
        const balanceAfter = await testTokenB.balanceOf(deployer.address);
        expect(balanceAfter.sub(balanceBefore)).to.be.equal(amountOut).to.be.equal(returnAmount);
      });
      it("should performRoutesSwap through two routes", async function () {
        const swapAmount = parseUnits("1", decimalsA);
        const halfOfSwapAmount = swapAmount.div("2");

        const [, amountOutBOnFirstDex] = await dexAdapter.callStatic.getAmountsOut({
          encodedPath: getEncodedPath([testTokenA.address, testTokenB.address], dex),
          amount: halfOfSwapAmount,
          dexRouter: await DNS.getDexAddress(dex),
        });
        const [, amountOutBOnSecondDex] = await dexAdapter.callStatic.getAmountsOut({
          encodedPath: getEncodedPath([testTokenA.address, testTokenB.address], dex2),
          amount: halfOfSwapAmount,
          dexRouter: await DNS.getDexAddress(dex2),
        });

        const swapAmountB = amountOutBOnFirstDex.add(amountOutBOnSecondDex);
        const halfOfSwapAmountB = swapAmountB.div("2");

        const [, amountOutCOnFirstDex] = await dexAdapter.callStatic.getAmountsOut({
          encodedPath: getEncodedPath([testTokenB.address, testTokenC.address], dex),
          amount: halfOfSwapAmountB,
          dexRouter: await DNS.getDexAddress(dex),
        });
        const [, amountOutCOnSecondDex] = await dexAdapter.callStatic.getAmountsOut({
          encodedPath: getEncodedPath([testTokenB.address, testTokenC.address], dex2),
          amount: halfOfSwapAmountB,
          dexRouter: await DNS.getDexAddress(dex2),
        });
        const balanceBefore = await testTokenC.balanceOf(deployer.address);
        await dexAdapter.performRoutesSwap(testTokenA.address, swapAmount, deployer.address, doubleRoute);
        const balanceAfter = await testTokenC.balanceOf(deployer.address);

        expect(balanceAfter.sub(balanceBefore)).to.be.equal(amountOutCOnFirstDex.add(amountOutCOnSecondDex));
      });
    });
    describe("performMegaRoutesSwap", function () {
      it("should performMegaRoutesSwap through signle megaroute", async function () {
        const swapAmount = parseUnits("1", decimalsA);
        const [, amountOut] = await dexAdapter.callStatic.getAmountsOut({
          encodedPath: getEncodedPath([testTokenA.address, testTokenB.address], dex),
          amount: swapAmount,
          dexRouter: await DNS.getDexAddress(dex),
        });
        const balanceBefore = await testTokenB.balanceOf(deployer.address);
        await dexAdapter.performMegaRoutesSwap({
          tokenA: testTokenA.address,
          tokenB: testTokenB.address,
          amountTokenA: swapAmount,
          megaRoutes: singleMegaRoute,
          receiver: deployer.address,
          deadline: new Date().getTime() + 600,
        });
        const balanceAfter = await testTokenB.balanceOf(deployer.address);

        expect(balanceAfter.sub(balanceBefore)).to.be.equal(amountOut);
      });
      it("should performMegaRoutesSwap through double megaroute", async function () {
        const swapAmount = parseUnits("1", decimalsA);
        const quarterOfSwapAmount = swapAmount.div("4");

        // calculate amount on first mega route
        const [, amountOutBOnFirstDex] = await dexAdapter.callStatic.getAmountsOut({
          encodedPath: getEncodedPath([testTokenA.address, testTokenB.address], dex),
          amount: quarterOfSwapAmount,
          dexRouter: await DNS.getDexAddress(dex),
        });
        const [, amountOutBOnSecondDex] = await dexAdapter.callStatic.getAmountsOut({
          encodedPath: getEncodedPath([testTokenA.address, testTokenB.address], dex2),
          amount: quarterOfSwapAmount,
          dexRouter: await DNS.getDexAddress(dex2),
        });

        const swapAmountB = amountOutBOnFirstDex.add(amountOutBOnSecondDex);
        const halfOfSwapAmountB = swapAmountB.div("2");

        const [, amountOutCOnFirstDexFirstRoute] = await dexAdapter.callStatic.getAmountsOut({
          encodedPath: getEncodedPath([testTokenB.address, testTokenC.address], dex),
          amount: halfOfSwapAmountB,
          dexRouter: await DNS.getDexAddress(dex),
        });
        const [, amountOutCOnSecondDexFirstRoute] = await dexAdapter.callStatic.getAmountsOut({
          encodedPath: getEncodedPath([testTokenB.address, testTokenC.address], dex2),
          amount: halfOfSwapAmountB,
          dexRouter: await DNS.getDexAddress(dex2),
        });

        // calculate amount on second mega route
        const [, amountOutXOnFirstDex] = await dexAdapter.callStatic.getAmountsOut({
          encodedPath: getEncodedPath([testTokenA.address, testTokenX.address], dex),
          amount: quarterOfSwapAmount,
          dexRouter: await DNS.getDexAddress(dex),
        });
        const [, amountOutXOnSecondDex] = await dexAdapter.callStatic.getAmountsOut({
          encodedPath: getEncodedPath([testTokenA.address, testTokenX.address], dex2),
          amount: quarterOfSwapAmount,
          dexRouter: await DNS.getDexAddress(dex2),
        });

        const swapAmountX = amountOutXOnFirstDex.add(amountOutXOnSecondDex);
        const halfOfSwapAmountX = swapAmountX.div("2");

        const [, amountOutCOnFirstDexSecondRoute] = await dexAdapter.callStatic.getAmountsOut({
          encodedPath: getEncodedPath([testTokenX.address, testTokenC.address], dex),
          amount: halfOfSwapAmountX,
          dexRouter: await DNS.getDexAddress(dex),
        });
        const [, amountOutCOnSecondDexSecondRoute] = await dexAdapter.callStatic.getAmountsOut({
          encodedPath: getEncodedPath([testTokenX.address, testTokenC.address], dex2),
          amount: halfOfSwapAmountX,
          dexRouter: await DNS.getDexAddress(dex2),
        });
        const sumOfCToken = amountOutCOnFirstDexFirstRoute
          .add(amountOutCOnSecondDexFirstRoute)
          .add(amountOutCOnFirstDexSecondRoute)
          .add(amountOutCOnSecondDexSecondRoute);
        const balanceBefore = await testTokenC.balanceOf(deployer.address);
        await dexAdapter.performMegaRoutesSwap({
          tokenA: testTokenA.address,
          tokenB: testTokenC.address,
          amountTokenA: swapAmount,
          megaRoutes: doubleMegaRoute,
          receiver: deployer.address,
          deadline: new Date().getTime() + 600,
        });
        const balanceAfter = await testTokenC.balanceOf(deployer.address);
        expect(balanceAfter.sub(balanceBefore)).to.be.equal(sumOfCToken);
      });
    });
  });

  describe("Should getGas", function () {
    let dex, dexRouter;

    before(async function () {
      dex = process.env.DEX || "uniswap";
      dexRouter = await DNS.getDexAddress(dex);
    });

    it("Should getGas", async function () {
      expect(await dexAdapter.connect(caller).getGas(dexRouter)).to.be.equal(await getGas(dex));
    });

    it("Should revert getGas when dexRouter is zero", async function () {
      await expect(dexAdapter.connect(caller).getGas(AddressZero)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert getGas when dexRouter unknown type", async function () {
      await expect(dexAdapter.connect(caller).getGas(mockErc165.address)).to.be.revertedWithCustomError(ErrorsLibrary, "UNKNOWN_DEX_TYPE");
    });
  });
});
