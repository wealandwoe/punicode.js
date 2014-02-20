"use strict";
var Punycode = {};
(function() {

var div = function(a,b) {
	if (b===2) {return a>>>1;}
	return Math.floor(a/b);
};
/**
 * bias補正関数
 * @param  {Integer} delta     一般化可変長整数で表現される整数(非基本コードポイント)
 * @param  {Integer} numpoints ここまでの段階でエンコード/デコードされたコードポイントの数
 * @param  {Boolean} firsttime 初回算出時はtrue
 * @param  {Object}  opt       base,tmin,tmax,damp,skewを含むパラメータオブジェクト
 * @return {Integer} k         
*/
var adapt = function(delta,numpoints,firsttime,opt) {
	var base=opt.base,tmin=opt.tmin,tmax=opt.tmax,
			damp=opt.damp,skew=opt.skew;
	delta = firsttime ? delta>>>1 : div(delta,damp);
	delta = delta + div(delta, numpoints);
	var k = 0,dmin=div((base-tmin)*tmax,2);
	while(delta > dmin) {
		delta = div(delta, (base - tmin));
		k += base;
	}
	return k + div(((base - tmin + 1) * delta), (delta + skew));
};

var isValidParams = function(opt) {
	return 0<=opt.tmin && opt.tmin<=opt.tmax && opt.tmax<=(opt.base-1)
			&& opt.skew>=1 && opt.damp>=2 && (opt.initial_bias%opt.base)<=(opt.base-opt.tmin);
};

/**
 * Punycode用パラメータ
 * decode時はA-Zでもa-zでも同じ値(0-26)が返るようにcodepointsを設定
 * encode時は0-26がa-zになる
 * tmin,tmax,skew,damp,initial_biasなどはRFC3492のまま
*/
var Params = {
	base: 36, tmin: 1, tmax:26, skew:38, damp:700,
	initial_bias:72, initial_n:128,
	codepoints: (function(){ //[[65,66,67,...,48,49,...,57], {"A":0, "B":1, ..., "0":26, "9":35}]
		var a=[],cp={},i=-1;
		while(++i<36){i<26?(cp[i+65]=cp[i+97]=i,a.push(i+97)):(cp[i+22]=i,a.push(i+22));}
		return [a, cp];
	})(), 
	delimiter: 45 // "-"
};
/**
 * Base64で使う64文字 "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
 * でencodeするパラメータ。delimiterはPunycodeと同じ "-" のまま
 * tmin,tmax,skew,damp,initial_biasなどはこれが良いのか未検証
*/
var Base64Params = { //"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	base: 64, tmin: 1, tmax:42, skew:70, damp:700,
	initial_bias:128, initial_n:128,
	codepoints: (function(){
		var a=[],cp={},i=-1;
		while(++i<64){i<26?(cp[i+65]=i,a.push(i+65)):i<52?(cp[i+71]=i,a.push(i+71))
			:i<62?(cp[i-4]=i,a.push(i-4)):(cp[i==62?43:47]=i,a.push(i==62?43:47));}
		return [a, cp];
	})(), 
	delimiter: 45 // "-"
};
/**
 * Base85で使う85文字 "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~"
 * でencodeするパラメータ。delimiterはPunycodeと同じ "-" が使えないので "." にした
 * tmin,tmax,skew,damp,initial_biasなどはこれが良いのか未検証
*/
var Base85Params = { //"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~"
	base: 85, tmin: 1, tmax:60, skew:92, damp:700,
	initial_bias:170, initial_n:128,
	codepoints: (function(){
		var a=[],cp={},i=-1;
		while(++i<85){
			i<10?(cp[i+48]=i,a.push(i+48)):i<36?(cp[i+55]=i,a.push(i+55))
				:i<62?(cp[i+61]=i,a.push(i+61)):i<72?(cp[i-29+((i-59)>>>2)]=i,a.push(i-29+((i-59)>>>2)))
					:i<78?(cp[i-13]=i,a.push(i-13)):i<81?(cp[i+16]=i,a.push(i+16)):(cp[i+42]=i,a.push(i+42));
		}
		return [a, cp];
	})(), 
	delimiter: 46 // "."
};

var Status = {
	SUCCESS:0, BAD_INPUT:1, BIG_OUTPUT:2, OVERFLOW:3
};
var StatusMessage = {
	0: ["SUCCESS", ""],
	1: ["BAD_INPUT", "Input is invalid."],
	2: ["BIG_OUTPUT", "Output would exceed the space provided."],
	3: ["OVERFLOW", "Wider integers needed to process input."]
};
// 一般化可変長整数nが取り得る最大の値
var maxint = 0xffffffff; //32bit

/**
 * 配列エンコード処理
 * @param  {Array}         input 入力整数配列
 * @param  {Object}        opt   Bootstringパラメータ
 * @return {Array|Integer} 変換後整数配列 または エラーの場合にエラーコード(Status.BAD_INPUT,BIG_OUTPUT,OVERFLOW)
*/
var encode_array = function(input, opt) {
	var opt=opt||Params,n=opt.initial_n, delta=0,max_out=opt.max_out||0xffffff,
			bias=opt.initial_bias,j,m,q,k,t,h,b=0,
			cp=opt.codepoints[0], base=opt.base, delim=opt.delimiter,
			tmin=opt.tmin, tmax=opt.tmax,
			ilen=input.length,output=[];
	/* Handle the basic code points: */
	for(j=0; j<ilen; j++) {
		if ((h=input[j])<opt.initial_n) {
			if (max_out-b<2) {return Status.BIG_OUTPUT;}
			output.push(h);
			b++;
		}
		/* else if (input[j] < n) return Status.BAD_INPUT; */
		/* (not needed for Punycode with unsigned code points) */
	}
	h=b;
	/* h is the number of code points that have been handled, b is the	*/
	/* number of basic code points, and out is the number of characters */
	/* that have been output.                                           */
	if (b>0){output.push(delim);}

  /* Main encoding loop: */
	while (h < ilen) {
		/* All non-basic code points < n have been     */
		/* handled already.  Find the next larger one: */
		for (m=maxint, j=0;  j<ilen; j++) {
			/* if (basic(input[j])) continue; */
			/* (not needed for Punycode) */
			if (input[j] >= n && input[j] < m) {m=input[j];}
		}
		/* Increase delta enough to advance the decoder's    */
		/* <n,i> state to <m,0>, but guard against overflow: */
		if (m-n>(maxint-delta)/(h+1)) {return Status.OVERFLOW;}
		delta += (m-n)*(h+1);
		n=m;
		for (j=0; j<ilen; j++) {
			/* Punycode does not need to check whether input[j] is basic: */
			if (input[j]<n /* || basic(input[j]) */ ) {
				if (++delta === 0) {return Status.OVERFLOW;}
			}
			if (input[j]===n) {
				/* Represent delta as a generalized variable-length integer: */
				for (q=delta, k=base; ; k+=base) {
					if (b >= max_out) {return Status.BIG_OUTPUT;}
					t = k <= bias /* + tmin */ ? tmin :     /* +tmin not needed */
							k >= bias + tmax ? tmax : k - bias;
					if (q < t) {break;}
					output.push( cp[t+(q-t) % (base-t)] );
					q = div(q-t, base-t);
				}
				output.push( cp[q] );
				bias = adapt(delta, h+1, h === b, opt);
				delta = 0;
				++h;
			}
		}
		++delta, ++n;
	}
	//*output_length = out;
	//return punycode_success;
	return output;
};

/**
 * 配列デコード処理
 * @param  {Array}         input 入力整数配列
 * @param  {Object}        opt   Bootstringパラメータ
 * @return {Array|Integer} 変換後整数配列 または エラーの場合にエラーコード(Status.BAD_INPUT,BIG_OUTPUT,OVERFLOW)
*/
var decode_array = function(input, opt) {
	var opt=opt||Params,base=opt.base, tmin=opt.tmin, tmax=opt.tmax,
			n=opt.initial_n, i=0, bias=opt.initial_bias,
			cp=opt.codepoints[1], delim=opt.delimiter,
			c,b,j,output=[],
			max_out=opt.max_out||0xffffff,ilen=input.length;
	for (b=j=0; j<ilen; j++) {
		input[j]===delim && (b=j);
	}
	if (b>max_out) {return Status.BIG_OUTPUT;}
	for(j=0; j<b; j++) {
		//if (case_flags) case_flags[out] = flagged(input[j]);
		if ((c=input[j])>=opt.initial_n) {return Status.BAD_INPUT;}
		output.push(c);
	}
//		console.debug(output);
	var _in=0,_out=output.length,oldi=i,t,w=1,k=base,digit;
	for(_in=b>0?b+1:0; _in<ilen; _out++) {
		for(oldi=i,w=1,k=base; ; k+=base) {
			if (_in>=ilen){return Status.BAD_INPUT;}
			digit = cp[input[_in++]];
			if (digit>=base){return Status.BAD_INPUT;}
			if (digit>div((maxint-i),w)) {return Status.OVERFLOW;}
			i += digit * w;
			t = k<=bias?tmin: k>=bias+tmax?tmax:k-bias;
			if (digit<t){break;}
			if (w>div(maxint,(base-t))) {return Status.OVERLOW;}
			w *= (base-t);
		}
		bias = adapt(i-oldi, _out+1, oldi===0, opt);
		if (div(i,(_out+1))>maxint-n) {return Punycode.OVERFLOW;}
		n += div(i,(_out+1));
		i %= (_out+1);
		/* not needed for Punycode: */
		// if (cp[n]<=base) {return Status.INVALID_INPUT;}
		if (_out>=max_out) {return Status.BIG_OUTPUT;}
		output = output.slice(0,i).concat([n]).concat(output.slice(i));
		i++;
	}
//		console.debug(output);
	return output;
};
/**
 * 文字列エンコード処理
 *   JS文字列を整数配列に分解しencode_arrayに渡し、結果を文字列にして返す
*/
var encode = function(input_str, opt) {
	var input=[],i,len=input_str.length,output=[],output_str="";
	for(i=0; i<len; i++) {
		input[i] = input_str.charCodeAt(i);
	}
	output = encode_array(input, opt);
	if (typeof output === 'number') {return output;}
	len = output.length;
	for(i=0; i<len; i++) {
		output_str += String.fromCharCode(output[i]);
	}
	return output_str;
};
/**
 * 文字列デコード処理
 *   JS文字列を整数配列に分解しdecode_arrayに渡し、結果を文字列にして返す
*/
var decode = function(input_str, opt) {
	var input=[],i,len=input_str.length,output=[],output_str="";
	for(i=0; i<len; i++) {
		input[i] = input_str.charCodeAt(i);
	}
	output = decode_array(input, opt);
	if (typeof output === 'number') {return output;}
	len = output.length;
	for(i=0; i<len; i++) {
		output_str += String.fromCharCode(output[i]);
	}
	return output_str;
};

Punycode.isValidParams = isValidParams;
Punycode.Params = Params;
Punycode.Base64Params = Base64Params;
Punycode.Base85Params = Base85Params;
Punycode.Status = Status;
Punycode.StatusMessage = StatusMessage;
Punycode.encode = encode;
Punycode.decode = decode;
})();