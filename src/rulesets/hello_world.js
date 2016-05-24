module.exports = {
  provided_functions: {
    hello: {
      type: 'query',
      fn: function(ctx, callback){
        callback(undefined, 'Hello ' + ctx.args.obj);
      }
    }
  },
  rules: {
    hello_world: {
      select: function(ctx, callback){
        callback(undefined,
            ctx.event.domain === 'echo' && ctx.event.type === 'hello');
      },
      action: function(ctx, callback){
        callback(undefined, {
          type: 'directive',
          name: 'say',
          options: {
            something: 'Hello World'
          }
        });
      }
    }
  }
};
