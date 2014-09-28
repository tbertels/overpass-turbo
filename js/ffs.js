// ffs/wizard module
if (typeof turbo === "undefined") turbo={};
turbo.ffs = function() {
  var ffs = {};
  var freeFormQuery;

  /* this converts a random boolean expression into a normalized form: 
   * A∧B∧… ∨ C∧D∧… ∨ …
   * for example: A∧(B∨C) ⇔ (A∧B)∨(A∧C)
   */
  function normalize(query) {
    var normalized_query = {
      logical:"or",
      queries:[]
    };
    function normalize_recursive(rem_query) {
      if (!rem_query.logical) {
        return [{
          logical: "and",
          queries: [rem_query]
        }];
      } else if (rem_query.logical === "and") {
        var c1 = normalize_recursive( rem_query.queries[0] );
        var c2 = normalize_recursive( rem_query.queries[1] );
        // return cross product of c1 and c2
        var c = [];
        for (var i=0; i<c1.length; i++)
          for (var j=0; j<c2.length; j++) {
            c.push({
              logical: "and",
              queries: c1[i].queries.concat(c2[j].queries)
            });
          }
        return c;
      } else if (rem_query.logical === "or") {
        var c1 = normalize_recursive( rem_query.queries[0] );
        var c2 = normalize_recursive( rem_query.queries[1] );
        return [].concat(c1,c2);

      } else {
        alert("unsupported boolean operator: "+rem_query.logical);
      }
    }
    normalized_query.queries = normalize_recursive(query);
    return normalized_query;
  }

  ffs.construct_query = function(search, comment) {
    try {
      ffs = turbo.ffs.parser.parse(search);
    } catch(e) {
      //alert("parse error :(");
      return false;
    }

    var query_parts = [];
    var bounds_part;

    query_parts.push('<!--');
    if (comment) {
      query_parts.push(comment)
    } else {
      query_parts.push('This has been generated by the overpass-turbo wizard.');
      query_parts.push('The original search was:');
      query_parts.push('“'+search+'”');
    }
    query_parts.push('-->');
    query_parts.push('<osm-script output="json" timeout="25">');

    switch(ffs.bounds) {
      case "area": 
        query_parts.push('  <!-- fetch area “'+ffs.area+'” to search in -->');
        query_parts.push('  <id-query {{nominatimArea:'+ffs.area+'}} into="area"/>');
        bounds_part = '<area-query from="area"/>';
      break;
      case "around":
        query_parts.push('  <!-- adjust the search radius (in meters) here -->');
        query_parts.push('  {{radius=1000}}');
        bounds_part = '<around {{nominatimCoords:'+ffs.area+'}} radius="{{radius}}"/>';
      break;
      case "bbox":
        bounds_part = '<bbox-query {{bbox}}/>';
      break;
      case "global":
        bounds_part = undefined;
      break;
      default:
        alert("unknown bounds condition: "+ffs.bounds);
        return false;
      break;
    }

    function get_query_clause(condition) {
      function esc(str) {
        // overpass API gets confused over tabs and newline characters
        // see https://github.com/drolbr/Overpass-API/issues/91
        return htmlentities(str).replace(/\t/g,"&#09;").replace(/\n/g,"&#10;").replace(/\r/g,"&#13;");
      }
      function escRegexp(str) {
        return str.replace(/([()[{*+.$^\\|?])/g, '\\$1');
      }
      var key = esc(condition.key);
      var val = esc(condition.val);
      // convert substring searches into matching regexp ones
      if (condition.query === "substr") {
        condition.query = "like";
        condition.val={regex:escRegexp(condition.val)};
      }
      // special case for empty values
      // see https://github.com/drolbr/Overpass-API/issues/53
      if (val === '') {
        if (condition.query === "eq") {
          condition.query = "like";
          condition.val={regex:'^$'};
        } else if (condition.query === "neq") {
          condition.query = "notlike";
          condition.val={regex:'^$'};
        }
      }
      // special case for empty values
      // see https://github.com/drolbr/Overpass-API/issues/53#issuecomment-26325122
      if (key === '') {
        if (condition.query === "key") {
          condition.query = "likelike";
          key='^$';
          condition.val={regex: '.*'};
        } else if (condition.query === "eq") {
          condition.query = "likelike";
          key='^$';
          condition.val={regex: '^'+escRegexp(condition.val)+'$'};
        } else if (condition.query === "like") {
          condition.query = "likelike";
          key='^$';
        }
      }
      // construct the query clause
      switch(condition.query) {
        case "key":
          return '<has-kv k="'+key+'"/>';
        case "nokey":
          return '<has-kv k="'+key+'" modv="not" regv=".*"/>';
        case "eq":
          return '<has-kv k="'+key+'" v="'+val+'"/>';
        case "neq":
          return '<has-kv k="'+key+'" modv="not" v="'+val+'"/>';
        case "like":
          return '<has-kv k="'+key+'" regv="'+esc(condition.val.regex)+'"'
                 +(condition.val.modifier==="i"?' case="ignore"':'')
                 +'/>';
        case "likelike":
          return '<has-kv regk="'+key+'" regv="'+esc(condition.val.regex)+'"'
                 +(condition.val.modifier==="i"?' case="ignore"':'')
                 +'/>';
        case "notlike":
          return '<has-kv k="'+key+'" modv="not" regv="'+esc(condition.val.regex)+'"'
                 +(condition.val.modifier==="i"?' case="ignore"':'')
                 +'/>';
        case "meta":
          switch(condition.meta) {
            case "id":
              return function(type) {
                return '<id-query type="'+type+'" ref="'+val+'"/>';
              };
            case "newer":
              if (condition.val.match(/^-?\d+ ?(seconds?|minutes?|hours?|days?|weeks?|months?|years?)?$/))
                return '<newer than="{{date:'+val+'}}"/>';
              return '<newer than="'+val+'"/>';
            case "user":
              return '<user name="'+val+'"/>';
            case "uid":
              return '<user uid="'+val+'"/>';
            default:
              console.log("unknown query type: meta/"+condition.meta);
              return false;
          }
        case "free form":
          // own module, special cased below
        default:
          console.log("unknown query type: "+condition.query);
          return false;
      }
    }
    function get_query_clause_str(condition) {
      function quotes(s) {
        if (s.match(/^[a-zA-Z0-9_]+$/) === null)
          return '"'+s.replace(/"/g,'\\"')+'"';
        return s;
      }
      function quoteRegex(s) {
        if (s.regex.match(/^[a-zA-Z0-9_]+$/) === null || s.modifier)
          return '/'+s.regex.replace(/\//g,'\\/')+'/'+(s.modifier||'');
        return s.regex;
      }
      switch(condition.query) {
        case "key":
          return quotes(condition.key)+'=*';
        case "nokey":
          return quotes(condition.key)+'!=*';
        case "eq":
          return quotes(condition.key)+'='+quotes(condition.val);
        case "neq":
          return quotes(condition.key)+'!='+quotes(condition.val);
        case "like":
          return quotes(condition.key)+'~'+quoteRegex(condition.val);
        case "likelike":
          return '~'+quotes(condition.key)+'~'+quoteRegex(condition.val);
        case "notlike":
          return quotes(condition.key)+'!~'+quoteRegex(condition.val);
        case "substr":
          return quotes(condition.key)+':'+quotes(condition.val);
        case "meta":
          switch(condition.meta) {
            case "id":
              return 'id:'+quotes(condition.val);
            case "newer":
              return 'newer:'+quotes(condition.val);
            case "user":
              return 'user:'+quotes(condition.val);
            case "uid":
              return 'uid:'+quotes(condition.val);
            default:
              return '';
          }
        case "free form":
          return quotes(condition.free);
        default:
          return '';
      }
    }

    ffs.query = normalize(ffs.query);

    query_parts.push('  <!-- gather results -->');
    query_parts.push('  <union>');
    for (var i=0; i<ffs.query.queries.length; i++) {
      var and_query = ffs.query.queries[i];

      var types = ['node','way','relation'];
      var clauses = [];
      var clauses_str = [];
      for (var j=0; j<and_query.queries.length; j++) {
        var cond_query = and_query.queries[j];
        // todo: looks like some code duplication here could be reduced by refactoring
        if (cond_query.query === "free form") {
          // eventually load free form query module
          if (!freeFormQuery) freeFormQuery = turbo.ffs.free();
          var ffs_clause = freeFormQuery.get_query_clause(cond_query);
          if (ffs_clause === false)
            return false;
          // restrict possible data types
          types = types.filter(function(t) {
            return ffs_clause.types.indexOf(t) != -1;
          });
          // add clauses
          clauses_str.push(get_query_clause_str(cond_query));
          clauses = clauses.concat(ffs_clause.conditions.map(function(condition) {
            return get_query_clause(condition);
          }));
        } else if (cond_query.query === "type") {
          // restrict possible data types
          types = types.indexOf(cond_query.type) != -1 ? [cond_query.type] : [];
        } else {
          // add another query clause
          clauses_str.push(get_query_clause_str(cond_query));
          var clause = get_query_clause(cond_query);
          if (clause === false) return false;
          clauses.push(clause);
        }
      }
      clauses_str = clauses_str.join(' and ');

      // construct query
      query_parts.push('    <!-- query part for: “'+clauses_str+'” -->')
      for (var t=0; t<types.length; t++) {
        query_parts.push('    <query type="'+types[t]+'">');
        for (var c=0; c<clauses.length; c++)
          if (typeof clauses[c] !== "function")
            query_parts.push('      '+clauses[c]);
          else
            query_parts.push('      '+clauses[c](types[t]));
        if (bounds_part)
          query_parts.push('      '+bounds_part);
        query_parts.push('    </query>');
      }
    }
    query_parts.push('  </union>');

    query_parts.push('  <!-- print results -->');
    query_parts.push('  <print mode="body"/>');
    query_parts.push('  <recurse type="down"/>');
    query_parts.push('  <print mode="skeleton" order="quadtile"/>');

    query_parts.push('</osm-script>');

    return query_parts.join('\n');
  }

  // this is a "did you mean …" mechanism against typos in preset names
  ffs.repair_search = function(search) {
    try {
      ffs = turbo.ffs.parser.parse(search);
    } catch(e) {
      return false;
    }

    function quotes(s) {
      if (s.match(/^[a-zA-Z0-9_]+$/) === null)
        return '"'+s.replace(/"/g,'\\"')+'"';
      return s;
    }

    var search_parts = [];
    var repaired = false;

    ffs.query = normalize(ffs.query);
    ffs.query = _.flatten(_.pluck(ffs.query.queries,"queries"));
    ffs.query.forEach(function(cond_query) {
      if (cond_query.query === "free form") {
        // eventually load free form query module
        if (!freeFormQuery) freeFormQuery = turbo.ffs.free();
        var ffs_clause = freeFormQuery.get_query_clause(cond_query);
        if (ffs_clause === false) {
          // try to find suggestions for occasional typos
          var fuzzy = freeFormQuery.fuzzy_search(cond_query);
          var free_regex = new RegExp("['\"]?"+cond_query.free+"['\"]?");
          if (fuzzy && search.match(free_regex)) {
            search_parts = search_parts.concat(search.split(free_regex));
            search = search_parts.pop();
            var replacement = quotes(fuzzy);
            search_parts.push(replacement);
            repaired = true;
          }
        }
      }
    });
    search_parts.push(search);

    if (!repaired)
      return false;
    return search_parts;
  }

  return ffs;
};