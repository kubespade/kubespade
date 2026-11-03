package services

import (
	"context"
	"fmt"
	"time"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/eks"
)

type EKSCluster struct {
	Name     string `json:"name"`
	Endpoint string `json:"endpoint"`
	Status   string `json:"status"`
	Version  string `json:"version"`
	ARN      string `json:"arn"`
	CACert   string `json:"caCert"`
}

type EKSToken struct {
	Token  string
	Expiry time.Time
}

func ListEKSClusters(ctx context.Context, sess *AWSSession, region string) ([]EKSCluster, error) {
	cfg, err := sess.awsConfig(region)
	if err != nil {
		return nil, err
	}
	client := eks.NewFromConfig(cfg)

	var clusterNames []string
	paginator := eks.NewListClustersPaginator(client, &eks.ListClustersInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("list clusters: %w", err)
		}
		clusterNames = append(clusterNames, page.Clusters...)
	}

	clusters := make([]EKSCluster, 0, len(clusterNames))
	for _, name := range clusterNames {
		c, err := DescribeEKSCluster(ctx, sess, region, name)
		if err != nil {
			continue // skip clusters we can't describe
		}
		clusters = append(clusters, *c)
	}
	return clusters, nil
}

func DescribeEKSCluster(ctx context.Context, sess *AWSSession, region, clusterName string) (*EKSCluster, error) {
	cfg, err := sess.awsConfig(region)
	if err != nil {
		return nil, err
	}
	client := eks.NewFromConfig(cfg)

	result, err := client.DescribeCluster(ctx, &eks.DescribeClusterInput{
		Name: awssdk.String(clusterName),
	})
	if err != nil {
		return nil, fmt.Errorf("describe cluster %s: %w", clusterName, err)
	}

	c := result.Cluster
	caData := ""
	if c.CertificateAuthority != nil {
		caData = awssdk.ToString(c.CertificateAuthority.Data)
	}

	return &EKSCluster{
		Name:     awssdk.ToString(c.Name),
		Endpoint: awssdk.ToString(c.Endpoint),
		Status:   string(c.Status),
		Version:  awssdk.ToString(c.Version),
		ARN:      awssdk.ToString(c.Arn),
		CACert:   caData,
	}, nil
}

func GetEKSToken(ctx context.Context, sess *AWSSession, region, clusterName string) (*EKSToken, error) {
	token, expiry, err := GenerateEKSToken(ctx, sess, region, clusterName)
	if err != nil {
		return nil, err
	}
	return &EKSToken{Token: token, Expiry: expiry}, nil
}
