
/**
 * Module dependencies.
 */

var express = require('express')
  , routes = require('./routes')
  , user = require('./routes/user')
  , http = require('http')
  , path = require('path')
  , connect = require('connect')
  , jade = require('jade')
  , mongoose = require('mongoose')
  , mongoStore = require('connect-mongodb')
  , mailer = require('mailer')
  , connectTimeout = require('connect-timeout')
  , models = require('./models')
  , db
  , Document
  , User
  , LoginToken
  , emails;

var app = express();


function renderJadeFile(template, options) {
  var fn = jade.compile(template, options);
  return fn(options.locals);
}

emails = {
  send: function(template, mailOptions, templateOptions) {
    mailOptions.to = mailOptions.to;
    renderJadeFile(path.join(__dirname, 'views', 'mailer', template), templateOptions, function(err, text) {
      // Add the rendered Jade template to the mailOptions
      mailOptions.body = text;

      // Merge the app's mail options
      var keys = Object.keys(app.set('mailOptions')),
          k;
      for (var i = 0, len = keys.length; i < len; i++) {
        k = keys[i];
        if (!mailOptions.hasOwnProperty(k))
          mailOptions[k] = app.set('mailOptions')[k];
      }

      console.log('[SENDING MAIL]', util.inspect(mailOptions));

      // Only send mails in production
      if (app.settings.env == 'production') {
        mailer.send(mailOptions,
          function(err, result) {
            if (err) {
              console.log(err);
            }
          }
        );
      }
    });
  },

  sendWelcome: function(user) {
    this.send('welcome.jade', { to: user.email, subject: 'Welcome to Nodepad' }, { locals: { user: user } });
  }
};


//development only
if ('development' == app.get('env')) {
	console.log('env');
	app.set('db-uri', 'mongodb://localhost/notepad-development');
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
}

models.defineModels(mongoose, function() {
	app.Document = Document = mongoose.model('Document');
	app.User = User = mongoose.model('User');
	app.LoginToken = LoginToken = mongoose.model('LoginToken');
	
	console.log(app.get('db-uri'));
	console.log(LoginToken);
	
	db = mongoose.connect(app.set('db-uri'));
});
	
// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.bodyParser());
app.use(express.cookieParser());
app.use(connectTimeout({ time: 10000 }));
app.use(express.session({ secret: 'secret' }));
app.use(express.methodOverride());
app.use(app.router);
app.set('mailOptions', {
    host: 'localhost',
    port: '25',
    from: 'nodepad@example.com'
  });
app.use(express.static(path.join(__dirname, 'public')));


function authenticateFromLoginToken(req, res, next) {
	console.log('authenticateFromLoginToken');
	
  var cookie = JSON.parse(req.cookies.logintoken);

  LoginToken.findOne({ email: cookie.email,
                       series: cookie.series,
                       token: cookie.token }, (function(err, token) {
    if (!token) {
      res.redirect('/sessions/new');
      return;
    }

    User.findOne({ email: token.email }, function(err, user) {
      if (user) {
        req.session.user_id = user.id;
        req.currentUser = user;

        token.token = token.randomToken();
        token.save(function() {
          res.cookie('logintoken', token.cookieValue, { expires: new Date(Date.now() + 2 * 604800000), path: '/' });
          next();
        });
      } else {
        res.redirect('/sessions/new');
      }
    });
  }));
}

function loadUser(req, res, next) {
	console.log('loadUser');
	
	if(req.session.user_id){
		User.findById(req.session.user_id, function(err, user) {
			if(user){
				req.currentUser = user;
				next();
			} else{
				res.redirect('/sessions/new');
			}
		});
	} else if(req.cookies.logintoken) {
		authenticateFromLoginToken(req, res, next);		
	} else {
		res.redirect('/sessions/new');
	}
}

//app.get('/', routes.index);
app.get('/', loadUser, function(req, res){
	console.log('get');
	res.redirect('/documents');
});

//app.get('/users', user.list);


app.get('/documents', function(req, res){
	console.log('get documents');
	
	//var documents = Document.find().all();
	
	//res.send(documents);
});

app.get('/sessions/new', function(req, res){
	console.log('get sessions-new');
	
	res.render('sessions/new.jade', {
		locals: { user: new User() }
	});
});

app.post('/sessions', function(req, res){
  console.log('post sessions');
  
  User.findOne({ email: req.body.user.email }, function(err, user) {
    if (user && user.authenticate(req.body.user.password)) {
      req.session.user_id = user.id;

      // Remember me
      if (req.body.remember_me) {
        var loginToken = new LoginToken({ email: user.email });
        loginToken.save(function() {
          res.cookie('logintoken', loginToken.cookieValue, { expires: new Date(Date.now() + 2 * 604800000), path: '/' });
          res.redirect('/documents');
        });
      } else {
        res.redirect('/documents');
      }
    } else {
      req.flash('error', 'Incorrect credentials');
      res.redirect('/sessions/new');
    }
  }); 
});

http.createServer(app).listen(app.get('port'), function(){
  console.log('Express server listening on port ' + app.get('port'));
  console.log('Using connect %s, Express %s, Jade %s', connect.version, express.version, jade.version);
});
