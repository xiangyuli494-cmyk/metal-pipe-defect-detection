const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (env, argv) => {
  const isDev = argv.mode !== 'production';

  return {
    mode: isDev ? 'development' : 'production',
    entry: './src/index.tsx',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'bundle.js'
    },
    module: {
      rules: [
        {
          test: /\.(ts|tsx|js|jsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                [
                  '@babel/preset-react',
                  {
                    runtime: 'automatic',
                    development: isDev
                  }
                ],
                '@babel/preset-env',
                '@babel/preset-typescript'
              ]
            }
          }
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader', 'postcss-loader']
        }
      ]
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx']
    },
    devServer: {
      port: 3015,
      allowedHosts: ['all', '.alibaba-inc.com'],
      historyApiFallback: {
        index: '/index.html',
        rewrites: [
          { from: /^\/_p\/\d+\//, to: '/index.html' }
        ]
      },
      // 代理配置：把所有 /api 请求代理到后端 8002 端口
      proxy: {
        '/api': {
          target: 'http://localhost:8002',
          changeOrigin: true,
          secure: false
        },
        '/uploads': {
          target: 'http://localhost:8002',
          changeOrigin: true,
          secure: false
        }
      }
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './public/index.html',
        inject: 'body'
      })
    ]
  };
};
