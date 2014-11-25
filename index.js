'use strict';

module.exports = function(config_option) {
	config_option || (config_option = {});
	return function(command, bone) {		
		var rewire = require('rewire');
		var compatible = require('bone-compatible');
		var path = require('path'),
			connect = require('connect'),
			http = require('http'),
			https = require('https'),
			injectLiveReload = require('connect-livereload'),
			open = require('open'),
			portscanner = require('portscanner'),
			async = require('async'),
			Gaze = require('gaze'),
			_ = require('underscore');

		if(config_option.notBone) {
			var serveIndex = require('serve-index');
			var serveStatic = require('serve-static');
		} else {
			var serveIndex = compatible('serve-index');
			var send = compatible('send');
			var serveStatic = rewire('serve-static');
			serveStatic.__set__('send', send);
		}

		var MAX_PORTS = 30; // Maximum available ports to check after the specified port

		var createDefaultMiddleware = function createDefaultMiddleware(connect, options) {
			var middlewares = [];

			var directory = options.directory || options.base[options.base.length - 1];
			options.base.forEach(function(base) {
				// Serve static files.
				middlewares.push(serveStatic(base));
			});
			// Make directory browse-able.
			middlewares.push(serveIndex(directory));
			return middlewares;
		};

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
					console.log('protocol option must be \'http\' or \'https\'');
				}

				// Connect requires the base path to be absolute.
				if (!Array.isArray(options.base)) {
					options.base = [options.base];
				}

				options.base = options.base.map(function(base) {
					if(config_option.notBone) {
						return path.resolve(base);
					} else {
						return bone.fs.pathResolve(base);
					}
				});

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

				// Start server.
				var taskTarget = this.target;

				async.waterfall([
					// find a port for livereload if needed first
					function(callback) {

						// Inject live reload snippet
						if (options.livereload !== false) {
							if (options.livereload === true) {
								options.livereload = 35729;
							}

							// TODO: Add custom ports here?
							middleware.unshift(injectLiveReload({
								port: options.livereload
							}));
							callback(null);
						} else {
							callback(null);
						}
					},
					function() {

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
							if (options.port !== foundPort && options.useAvailablePort === false) {
								console.log('Port ' + options.port + ' is already in use by another process.');
								return;
							}

							server
								.listen(foundPort, options.hostname)
								.on('listening', function() {
									var address = server.address();
									var hostname = options.hostname || '0.0.0.0';
									var target = options.protocol + '://' + hostname + ':' + address.port;

									console.log('Started connect web server on ' + target);
								})
								.on('error', function(err) {
									if (err.code === 'EADDRINUSE') {
										console.log('Port ' + foundPort + ' is already in use by another process.');
									} else {
										console.log(err);
									}
								});
							if(!config_option.notBone) {
								var gaze = new Gaze(['**/*', '!**/node_modules/**'], {cwd: bone.fs.base});
								gaze.on('all', function(event, filepath) {
									if(event == 'added' || event == 'renamed' || event == 'deleted') {
										bone.fs.refresh();
									}
								});
							}
						});
					}
				]);
			});
	}
};
