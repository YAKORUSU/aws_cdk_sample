#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { VpcStack } from '../lib/vpc-stack';
import { SecurityStack } from '../lib/security-stack';
import { RdsStack } from '../lib/rds-stack';
import { ServiceStack } from '../lib/service-stack';
import { MonitoringStack } from '../lib/monitoring-stack';

const app = new cdk.App();
const region = process.env.CDK_DEFAULT_REGION || 'ap-northeast-1';

// 1. VPC
const vpcStack = new VpcStack(app, 'VpcStack', { env: { region } });

// 2. Security (SG, IAM roles)
const securityStack = new SecurityStack(app, 'SecurityStack', {
  env: { region },
  vpc: vpcStack.vpc,
});

// 3. RDS (DB)
const rdsStack = new RdsStack(app, 'RdsStack', {
  env: { region },
  vpc: vpcStack.vpc,
  rdsSecurityGroup: securityStack.rdsSecurityGroup,
  privateSubnets: vpcStack.privateSubnets,
});

// 4. Service (ALB + ECS)
const serviceStack = new ServiceStack(app, 'ServiceStack', {
  env: { region },
  vpc: vpcStack.vpc,
  privateSubnets: vpcStack.privateSubnets,
  albSecurityGroup: securityStack.albSecurityGroup,
  ecsSecurityGroup: securityStack.ecsSecurityGroup,
  ecsTaskRole: securityStack.ecsTaskRole,
});

// 5. Monitoring
new MonitoringStack(app, 'MonitoringStack', {
  env: { region },
  alb: serviceStack.alb,
  targetGroup: serviceStack.targetGroup,
  ecsService: serviceStack.ecsService,
  rdsInstance: rdsStack.rdsInstance,
});
