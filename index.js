'use strict';

module.exports = function(config_option) {
	config_option || (config_option = {});
	return function(command, bone, bonefs) {
		if(bone.version < '0.1.0') {
			console.log('bone-cli-connect require bone version >= 0.1.0');
			process.exit(0);
		}
		command('connect')
			.option('--base <base>', 'set root path.')
			.option('--host <host>', 'set hostname.')
			.option('--port <port>', 'setup port.')
			.option('--debug <debug>', 'set "true" to enable debug model.')
			.option('--livereload <livereload>', 'set "true" to enable livereload.')
			.description('Start a connect web server.')
			.action(function(argv) {
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
					rewire = require('rewire'),
					serveStatic = rewire('serve-static'),
					serveIndex = compatible('serve-index', null, bonefs),
					send = compatible('send', null, bonefs);

					serveStatic.__set__('send', send);

				var MAX_PORTS = 30; // Maximum available ports to check after the specified port

				var createDefaultMiddleware = function createDefaultMiddleware(connect, options) {
					var middlewares = [];

					var directory = options.directory || options.base;
					// Serve static files.
					middlewares.push(serveStatic(options.base));
					// Make directory browse-able.
					middlewares.push(serveIndex(directory));
					return middlewares;
				};

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

				options.base = bonefs.pathResolve(options.base);

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
							var filePath = bonefs.pathResolve(path.join(options.base, pathname));
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
					} else {
						options.livereload = 35729;
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

					var watcher = bone.watch();

					watcher.on('changed', function(file) {
						if(options.livereload) {
							file = bonefs.pathResolve(file);
							var changed;
							if(liveReloadMap[file]) {
								changed = liveReloadMap[file];
							} else {
								changed = [file];
							}

							changed.forEach(function(f) {
								var changedFile = [f];

								if(bone.utils.fs.getByDependentFile) {
									var dependenics = bone.utils.fs.getByDependentFile(f);

									if(dependenics) {
										changedFile = changedFile.concat(dependenics);
									}
								}

								changedFile = bone.utils.filter(changedFile, function(file) {
									if(file.indexOf(options.base) !== -1) {
										return true;
									} else {
										return false;
									}
								});

								bone.utils.each(changedFile, function(file) {
									if(options.livereloadFilter) {
										file = options.livereloadFilter(file);
									}
									if(file) {
										tinylr.changed(String(file));
									}
								});
							});
						}
					});
				});
			});
	}
};