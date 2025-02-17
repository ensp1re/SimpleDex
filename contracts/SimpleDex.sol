// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SimpleDex {
    struct LiquidityPool {
        uint256 tokenAReserve;
        uint256 tokenBReserve;
    }

    struct Trade {
        address trader;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOut;
        uint256 timestamp;
    }

    mapping(address => mapping(address => LiquidityPool)) public liquidityPools;
    mapping(address => mapping(address => uint256)) public liquidity;
    mapping(address => Trade[]) public tradeHistory;

    event LiquidityAdded(
        address indexed tokenA,
        address indexed tokenB,
        uint256 amountA,
        uint256 amountB,
        uint256 timestamp
    );

    event LiquidityRemoved(
        address indexed tokenA,
        address indexed tokenB,
        uint256 amountA,
        uint256 amountB,
        uint256 timestamp
    );

    event TradeExecuted(
        address indexed trader,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) external {
        require(tokenA != tokenB, "Tokens must be different");
        require(amountA > 0 && amountB > 0, "Amount must be greater than 0");

        IERC20(tokenA).transferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).transferFrom(msg.sender, address(this), amountB);

        LiquidityPool storage pool = liquidityPools[tokenA][tokenB];
        pool.tokenAReserve += amountA;
        pool.tokenBReserve += amountB;

        uint256 liquidityMinted = _calculateLiquidity(amountA, amountB);
        liquidity[tokenA][tokenB] += liquidityMinted;

        emit LiquidityAdded(tokenA, tokenB, amountA, amountB, block.timestamp);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidityAmount
    ) external {
        require(liquidityAmount > 0, "Amount must be greater than 0");
        require(
            liquidity[tokenA][tokenB] >= liquidityAmount,
            "Not enough liquidity"
        );
        require(
            liquidityPools[tokenA][tokenB].tokenAReserve > 0 &&
                liquidityPools[tokenA][tokenB].tokenBReserve > 0,
            "Liquidity pool is empty"
        );
        require(tokenA != tokenB, "Tokens must be different");

        LiquidityPool storage pool = liquidityPools[tokenA][tokenB];
        uint256 totalLiquidity = _calculateLiquidity(
            pool.tokenAReserve,
            pool.tokenBReserve
        );

        uint256 amountA = (pool.tokenAReserve * liquidityAmount) /
            totalLiquidity;
        uint256 amountB = (pool.tokenBReserve * liquidityAmount) /
            totalLiquidity;

        require(amountA > 0 && amountB > 0, "Amount must be greater than 0");

        pool.tokenAReserve -= amountA;
        pool.tokenBReserve -= amountB;

        liquidity[tokenA][tokenB] -= liquidityAmount;

        IERC20(tokenA).transfer(msg.sender, amountA);
        IERC20(tokenB).transfer(msg.sender, amountB);

        emit LiquidityRemoved(
            tokenA,
            tokenB,
            amountA,
            amountB,
            block.timestamp
        );
    }

    function swapTokens(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external {
        require(tokenIn != tokenOut, "Tokens must be different");
        require(amountIn > 0, "Amount must be greater than 0");

        LiquidityPool storage pool = liquidityPools[tokenIn][tokenOut];

        uint256 reserveIn;
        uint256 reserveOut;

        if (tokenIn < tokenOut) {
            reserveIn = pool.tokenAReserve;
            reserveOut = pool.tokenBReserve;
        } else {
            reserveIn = pool.tokenBReserve;
            reserveOut = pool.tokenAReserve;
        }

        uint256 amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
        require(amountOut > 0, "Insufficient output amount");

        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(msg.sender, amountOut);

        if (tokenIn < tokenOut) {
            pool.tokenAReserve += amountIn;
            pool.tokenBReserve -= amountOut;
        } else {
            pool.tokenAReserve -= amountOut;
            pool.tokenBReserve += amountIn;
        }

        tradeHistory[msg.sender].push(
            Trade(
                msg.sender,
                tokenIn,
                tokenOut,
                amountIn,
                amountOut,
                block.timestamp
            )
        );

        emit TradeExecuted(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256) {
        require(amountIn > 0, "Insufficient input amount");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");

        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000) + amountInWithFee;

        return numerator / denominator;
    }

    function getPrice(
        address tokenA,
        address tokenB
    ) external view returns (uint256) {
        LiquidityPool storage pool = liquidityPools[tokenA][tokenB];
        require(
            pool.tokenAReserve > 0 && pool.tokenBReserve > 0,
            "Pool does not exist"
        );
        return (pool.tokenBReserve * 1e18) / pool.tokenAReserve;
    }

    function _calculateLiquidity(
        uint256 amountA,
        uint256 amountB
    ) internal pure returns (uint256) {
        return sqrt(amountA * amountB);
    }

    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function getTradeHistory(
        address trader,
        address tokenIn,
        address tokenOut,
        uint256 fromTimestamp,
        uint256 toTimestamp,
        uint256 limit,
        uint256 offset
    ) external view returns (Trade[] memory) {
        Trade[] storage trades = tradeHistory[trader];
        uint256 resultCount;
        uint256 actualOffset = offset;

        uint256 actualLimit = limit == 0
            ? trades.length
            : (limit > trades.length ? trades.length : limit);
        uint256 size = actualLimit > trades.length - actualOffset
            ? trades.length - actualOffset
            : actualLimit;

        Trade[] memory result = new Trade[](size);

        for (uint256 i = 0; i < trades.length && resultCount < size; i++) {
            if (
                (trader == address(0) || trades[i].trader == trader) &&
                (tokenIn == address(0) || trades[i].tokenIn == tokenIn) &&
                (tokenOut == address(0) || trades[i].tokenOut == tokenOut) &&
                trades[i].timestamp >= fromTimestamp &&
                (toTimestamp == 0 || trades[i].timestamp <= toTimestamp)
            ) {
                if (actualOffset > 0) {
                    actualOffset--;
                } else {
                    result[resultCount++] = trades[i];
                }
            }
        }
        return result;
    }

    function getTradeHistoryCount(
        address trader
    ) external view returns (uint256) {
        return tradeHistory[trader].length;
    }
}
