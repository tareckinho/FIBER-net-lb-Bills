'use strict';
const crypto = require('node:crypto');
function cellId(year, sheet, cell) {
  return 'cell-' + crypto.createHash('sha256').update(year + '\0' + sheet + '\0' + cell).digest('hex').slice(0, 32);
}
function workbookSnapshot() {
  const header = {font:{name:'Calibri',size:9,bold:true,italic:false,color:'#FFFFFF'},fill:{pattern:'solid',color:'#244062'},border:{top:{style:'thin',color:'#000000'},right:{style:'thin',color:'#000000'},bottom:{style:'thin',color:'#000000'},left:{style:'thin',color:'#000000'}},alignment:{horizontal:'center',vertical:'bottom',wrapText:false,textRotation:0},numberFormat:'General'};
  const body = {font:{name:'Calibri',size:10,bold:false,italic:false,color:'#1F497D'},fill:{pattern:'none',color:'#FFFFFF'},border:{},alignment:{horizontal:'right',vertical:'center',wrapText:false,textRotation:0},numberFormat:'0.00'};
  const sheet = (name, cells, extra = {}) => ({name,maxRow:5,maxCol:4,cells,styleRuns:[],columnWidths:{1:110,2:100,3:100,4:190},rowHeights:{1:26},defaultColumnWidth:64,defaultRowHeight:20,merges:[],tables:[],hiddenRows:[],hiddenColumns:[],filteredRows:[],zoomScale:100,showGridLines:true,...extra});
  return {format:'FIBERNETLB-ACCOUNTING-WORKBOOK-1',year:2026,name:'Fictional-workbook.xlsx',sha256:'a'.repeat(64),activeSheet:'Jan',styles:[header,body],sheets:[
    sheet('Jan', {
      A1:{value:'Amount',styleId:0},B1:{value:'Payment',styleId:0},C1:{value:'Balance',styleId:0},
      A2:{value:12,styleId:1},A3:{value:8,styleId:1},A4:{value:9999,formula:'=SUM(A2:A3)',styleId:1},
      B2:{value:4,styleId:1},B3:{value:6,styleId:1},B4:{value:9999,formula:'=SUM(B2:B3)',styleId:1},
      C2:{value:9999,formula:'=A2-B2',styleId:1},C3:{value:9999,formula:'=A3-B3',styleId:1},C4:{value:9999,formula:'=SUM(C2:C3)',styleId:1},
      D2:{value:'Fictional note',styleId:1},D3:{value:46147,styleId:1},D4:{value:9999,formula:'=SUBTOTAL(109,A2:A3)',styleId:1},D5:{value:9999,formula:'=SUBTOTAL(9,A2:A3)',styleId:1}
    }, {tables:[{name:'FictionalAmounts',ref:'A1:C4',columns:['Amount','Payment','Balance'],headerRowCount:1,totalsRowCount:1,styleInfo:{name:'TableStyleMedium23',showFirstColumn:false,showLastColumn:false,showRowStripes:true,showColumnStripes:false}}]}),
    sheet('Summary', {
      A1:{value:'Fictional workbook summary',styleId:0},
      A2:{value:'Twice charges',styleId:1},B2:{value:9999,formula:'=Jan!A4*2',styleId:1},
      A3:{value:'Outstanding',styleId:1},B3:{value:9999,formula:'=Jan!C4',styleId:1},
      C3:{value:314159,formula:'=DOESNOTEXIST(Jan!A2)',styleId:1},
      D3:{value:314159,formula:'=(globalThis.__fibernetWorkbookExecuted=true)',styleId:1},
      D4:{value:314159,formula:'=WEBSERVICE("https://never.invalid/")',styleId:1}
    }, {merges:['A1:D1']})
  ]};
}
module.exports = {workbookSnapshot, cellId};


