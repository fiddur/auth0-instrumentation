const bunyan = require('bunyan');
const Auth0SentryStream = require('./auth0_sentry_stream').Auth0SentryStream;
const ProcessInfo = require('auth0-common-logging').ProcessInfo;
const Serializers = require('auth0-common-logging').Serializers;
const HttpWritableStream = require('auth0-common-logging').Streams.HttpWritableStream;
const KinesisWritable = require('aws-kinesis-writable');

const utils = require('./utils');
const ErrorReporter = require('./error_reporter');
const KeepAliveAgent = require('./keep_alive_agent');
const logFormatter = require('./utils').logFormatter;

module.exports = function getLogger(pkg, env, serializers) {
  if (!serializers) {
    serializers = Serializers;
  }

  var bunyan_streams = [{
    level: env.CONSOLE_LOG_LEVEL || env.LOG_LEVEL,
    stream: process.stdout
  }];

  if (process.env.NODE_ENV === 'production' && env.LOG_TO_WEB_URL) {
    var httpStream = new HttpWritableStream(env.LOG_TO_WEB_URL);
    httpStream.on('error', function(err) {
      if (err) {
        console.error('Error on writing logs to web url', JSON.stringify({
          message: err.message,
          stack: err.stack
        }));
      } else {
        console.error('Error on writing logs to web url');
      }
    });
    bunyan_streams.push({
      name: 'web-url',
      stream: httpStream,
      level: env.LOG_TO_WEB_LEVEL || 'error'
    });
  }

  if (env.LOG_TO_KINESIS) {
    var keepAliveAgent = KeepAliveAgent(env);
    var stream = new KinesisWritable(utils.buildKinesisOptions(env, keepAliveAgent));

    var streamErrorHandler = function(err) {
      if (err) {
        console.error('Error on writing logs to Kinesis', JSON.stringify({
          message: err.message,
          records: err.records,
          stack: err.stack
        }));
      } else {
        console.error('Error on writing logs to Kinesis');
      }
    };

    stream.on('error', streamErrorHandler);

    bunyan_streams.push({
      name: 'kinesis',
      stream: stream,
      level: env.LOG_TO_KINESIS_LEVEL,
      type: env.LOG_TO_KINESIS_LOG_TYPE
    });

  }

  bunyan_streams.push({
    name: 'sentry',
    stream: new Auth0SentryStream(ErrorReporter(pkg, env)),
    level: env.ERROR_REPORTER_LOG_LEVEL || 'error',
    type: 'raw'
  });

  const process_info = ProcessInfo &&
    !env.IGNORE_PROCESS_INFO &&
    ProcessInfo.version !== '0.0.0' ? ProcessInfo : undefined;

  const logger = bunyan.createLogger({
    name:         pkg.name,
    process:      process_info,
    region:       env.AWS_REGION || undefined,
    service_name: env.SERVICE_NAME || undefined,
    channel:       env.RELEASE_CHANNEL,
    streams:      bunyan_streams,
    serializers:  serializers
  });

  logger.on('error', function(err, stream) {
    console.error('Cannot write to log stream ' + stream.name + ' ' + (err && err.message));
  });

  const captureLog = logFormatter(logger);

  return {
    trace: captureLog('trace'),
    debug: captureLog('debug'),
    info: captureLog('info'),
    warn: captureLog('warn'),
    error: captureLog('error'),
    fatal: captureLog('fatal')
  };
};
