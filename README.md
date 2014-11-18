# bone-connect
> 支持boneAPI的静态资源服务器

###安装
通过npm安装

```sh
npm install bone-connect
```

在你的`bonefile.js`里载入bone-connect模块

```js
var bone = require('bone');
var connect = require('bone-connect')(bone);
```
通过命令`bone connect`启动静态服务器

###可选参数

#####port


#####host


#####base


#####livereload
