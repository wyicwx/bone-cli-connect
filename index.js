'use strict';

module.exports = function(config_option) {
	config_option || (config_option = {});
	return function(command, bone) {
		var compatible = require('bone-compatible');
		var path = require('path'),
			connect = require('connect'),
			http = require('http'),
			https = require('https'),
			url = require('url'),
			injectLiveReload = require('connect-livereload'),
			open = require('open'),
			portscanner = require('portscanner'),
			async = require('async'),
			_ = bone.utils,
			fs = require('fs'),
			parseurl = require('parseurl'),
			serveStatic = require('serve-static'),
			serveIndex = compatible('serve-index');

		var MAX_PORTS = 30; // Maximum available ports to check after the specified port

		var createDefaultMiddleware = function createDefaultMiddleware(connect, options) {
			var middlewares = [];

			middlewares.push(boneMiddleware(options));

			var directory = options.directory || options.base;
			// options.base.forEach(function(base) {
				// Serve static files.
				middlewares.push(serveStatic(options.base));
			// });
			// Make directory browse-able.
			middlewares.push(serveIndex(directory));
			return middlewares;
		};

		var fileCache = {};
		var boneMiddleware = function(options) {
			return function(request, response, next) {
				if(request.method !== 'GET' && request.method !== 'HEAD') {
					return next();
				}

				var originalUrl = parseurl.original(request)
				var pathname = parseurl(request).pathname
				var hasTrailingSlash = originalUrl.pathname[originalUrl.pathname.length - 1] === '/'

				var pathname = path.join(options.base, pathname);
				if(bone.fs.existFile(pathname)) {
					bone.log.debug('connect > hit bone file: '+pathname);
					if(fileCache[pathname]) {
						bone.log.debug('connect > cached!');
						next();
					} else {
						bone.log.debug('connect > not cache, build now!');
						var readStream = bone.fs.createReadStream(pathname);
						var writeStream = bone.fs.createWriteStream(pathname, {focus: true});

						readStream.pipe(writeStream, {end: false});
						readStream.on('end', function() {
							fileCache[pathname] = 'build';
							next();
						});
					}
				} else {
					bone.log.debug('connect > normal request path: '+pathname);
					next();
				}
			};
		} 

		command('connect')
			.option('--base <base>', 'set root path.')
			.option('--host <host>', 'set hostname.')
			.option('--port <port>', 'setup port.')
			.option('--debug <debug>', 'set "true" to enable debug model.')
			.option('--livereload <livereload>', 'set "true" to enable livereload.')
			.description('Start a connect web server.')
			.action(function(argv) {
				// cmd_option > config_option > option
				var cmd_option = _.pick(argv, 'port', 'host', 'debug', 'base', 'livereload');
				if(cmd_option.debug) {
					cmd_option.debug = cmd_option.debug == 'true' ? true : false;
				}
				if(cmd_option.livereload) {
					cmd_option.livereload = cmd_option.livereload == 'true' ? true : false;
				}
				
				// Merge task-specific options with these defaults.
				var options = _.extend({
					protocol: 'http',
					port: 8000,
					hostname: '0.0.0.0',
					base: '.',
					directory: null,
					debug: false,
					livereload: false,
					open: false,
					useAvailablePort: false,
					// if nothing passed, then is set below 'middleware = createDefaultMiddleware.call(this, connect, options);'
					middleware: null
				}, config_option, cmd_option);


				if (options.protocol !== 'http' && options.protocol !== 'https') {
					bone.log.error('connect', 'protocol option must be \'http\' or \'https\'');
				}

				// Connect requires the base path to be absolute.
				if (Array.isArray(options.base)) {
					options.base = options.base[0];
				}

				options.base = bone.fs.pathResolve(options.base);

				// Connect will listen to all interfaces if hostname is null.
				if (options.hostname === '*') {
					options.hostname = '';
				}

				// Connect will listen to ephemeral port if asked
				if (options.port === '?') {
					options.port = 0;
				}

				//  The middleware options may be null, an array of middleware objects,
				//  or a factory function that creates an array of middleware objects.
				//  * For a null value, use the default array of middleware
				//  * For a function, include the default array of middleware as the last arg
				//    which enables the function to patch the default middleware without needing to know
				//    the implementation of the default middleware factory function
				var middleware;

				middleware = createDefaultMiddleware.call(this, connect, options);

				if (typeof(options.middleware) === 'function') {
					middleware = options.middleware.call(this, connect, options, middleware);
				}


				// If --debug was specified, enable logging.
				if (options.debug === true) {
					connect.logger.format('bone', ('[D] server :method :url :status ' +
						':res[content-length] - :response-time ms').magenta);
					middleware.unshift(connect.logger('bone'));
				}

				if(options.livereload !== false) {
					var liveReloadMap = {};
					var liveReloadFlag = {};
					middleware.unshift(function(req, res, next) {
						var pathname = url.parse(req.url).pathname;
						if(!liveReloadFlag[pathname]) {
							liveReloadFlag[pathname] = true;
							var filePath = bone.fs.pathResolve(path.join(options.base, pathname));
							var trackFile = bone.utils.fs.track(filePath);
							if(trackFile) {
								var source = trackFile.pop();
								if(!liveReloadMap[source]) {
									liveReloadMap[source] = [];
								}
								liveReloadMap[source].push(filePath);
							}
						}
						next();
					});


					if (options.livereload === true) {
						options.livereload = 35729;
					} else if(_.isNumber(Number(options.livereload))) {
						options.livereload = Number(options.livereload);
					}

					middleware.unshift(injectLiveReload({
						port: options.livereload
					}));
				}

				// Start server.
				var app = connect();
				var server = null;

				middleware.forEach(function(mw) {
					app.use(mw);
				});

				if (options.protocol === 'https') {
					server = https.createServer({
						key: options.key || "",
						cert: options.cert || "",
						ca: options.ca || "",
						passphrase: options.passphrase || 'bone-connect',
					}, app);
				} else {
					server = http.createServer(app);
				}

				portscanner.findAPortNotInUse(options.port, options.port + MAX_PORTS, options.hostname, function(error, foundPort) {
					// if the found port doesn't match the option port, and we are forced to use the option port
					if (options.port !== foundPort) {
						if(options.useAvailablePort === false) {
							bone.log.error('connect', 'Port ' + options.port + ' is already in use by another process.');
							return;
						} else {
							bone.log.warn('connect', 'Port ' + options.port + ' is already in use by another process.');
							bone.log.warn('connect', 'Port use ' + foundPort + ' ');
						}
					}

					server
						.listen(foundPort, options.hostname)
						.on('listening', function() {
							var address = server.address();
							var hostname = options.hostname || '0.0.0.0';
							var target = options.protocol + '://' + hostname + ':' + address.port;

							bone.log.info('connect', 'Started connect web server on ' + target);
						})
						.on('error', function(err) {
							if (err.code === 'EADDRINUSE') {
								bone.log.error('connect', 'Port ' + foundPort + ' is already in use by another process.');
							} else {
								console.log(err);
							}
						});

					if(options.livereload) {
						var tinylr = require('tiny-lr');

						tinylr().listen(options.livereload, function() {
							bone.log.info('connect', 'livereload server listen on ' + options.livereload);
						});
					}

					bone.helper.autoRefresh(function(watcher) {
						watcher.on('ready', function() {
							watcher.on('change', function(file) {
								bone.log.debug('connect > file change: '+file);
								if((file in fileCache) && fileCache[file] === 'build') {
									fileCache[file] = true;
								} else {
									fileCache = {};
								}

								if(options.livereload) {
									file = bone.fs.pathResolve(file);
									var changed;
									if(liveReloadMap[file]) {
										changed = liveReloadMap[file];
									} else {
										changed = [file];
									}

									changed.forEach(function(f) {
										if(options.livereloadFilter) {
											f = options.livereloadFilter(f);
										}
										if(f) {
											tinylr.changed(String(f));
										}
									});
								}
							});
						});
					});
				});
			});
	}
};